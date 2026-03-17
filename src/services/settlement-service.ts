import { queryAll, queryOne, runSql, saveDb } from '../db/instance.js';
import { calculateProfit, getSellRate, getCentralBankRate } from './rate-service.js';
import {
  Settlement,
  SettlementStage,
  SettlementBatchStatus,
  SETTLEMENT_STAGES,
  SettlementBatchSummary,
} from '../types/index.js';

// ============================================
// Stage Transition Logic
// ============================================

/**
 * Check if a stage transition is valid (must follow order)
 */
export function canTransitionStage(currentStage: SettlementStage, targetStage: SettlementStage): boolean {
  const currentIndex = SETTLEMENT_STAGES.indexOf(currentStage);
  const targetIndex = SETTLEMENT_STAGES.indexOf(targetStage);
  // Must advance exactly one step forward
  return targetIndex === currentIndex + 1;
}

/**
 * Transition a transaction to a new settlement stage
 */
export function transitionStage(
  transactionId: number,
  toStage: SettlementStage,
  userId: number,
  reason?: string
): { success: boolean; error?: string } {
  const tx = queryOne('SELECT * FROM transactions WHERE id = ?', [transactionId]);
  if (!tx) return { success: false, error: 'المعاملة غير موجودة' };

  const currentStage = (tx.settlement_stage || 'created') as SettlementStage;

  if (!canTransitionStage(currentStage, toStage)) {
    return {
      success: false,
      error: `لا يمكن الانتقال من "${currentStage}" إلى "${toStage}". يجب اتباع الترتيب الصحيح.`,
    };
  }

  const now = new Date().toISOString();

  // Update transaction stage
  runSql(
    'UPDATE transactions SET settlement_stage = ?, settlement_stage_updated_at = ? WHERE id = ?',
    [toStage, now, transactionId]
  );

  // Record in stage history
  runSql(
    `INSERT INTO settlement_stage_history (transaction_id, from_stage, to_stage, transitioned_at, transitioned_by, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [transactionId, currentStage, toStage, now, userId, reason || null]
  );

  saveDb();
  return { success: true };
}

/**
 * Bulk transition stages for multiple transactions
 */
export function bulkTransitionStage(
  transactionIds: number[],
  toStage: SettlementStage,
  userId: number,
  reason?: string
): { success: number; failed: number; errors: string[] } {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const txId of transactionIds) {
    const result = transitionStage(txId, toStage, userId, reason);
    if (result.success) {
      success++;
    } else {
      failed++;
      errors.push(`معاملة ${txId}: ${result.error}`);
    }
  }

  return { success, failed, errors };
}

// ============================================
// Settlement Batch Management
// ============================================

/**
 * Generate a unique batch reference
 */
function generateBatchReference(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `STL-${dateStr}-${random}`;
}

/**
 * Create a new settlement batch
 */
export function createSettlementBatch(
  transactionIds: number[],
  userId: number,
  notes?: string
): { batch: Settlement | null; error?: string } {
  if (!transactionIds || transactionIds.length === 0) {
    return { batch: null, error: 'يجب تحديد معاملة واحدة على الأقل' };
  }

  // Validate all transactions exist and are eligible
  for (const txId of transactionIds) {
    const tx = queryOne('SELECT * FROM transactions WHERE id = ?', [txId]);
    if (!tx) {
      return { batch: null, error: `المعاملة ${txId} غير موجودة` };
    }
    if (tx.settlement_batch_id) {
      return { batch: null, error: `المعاملة ${tx.reference} مضافة بالفعل لدفعة تسوية أخرى` };
    }
  }

  const now = new Date().toISOString();
  const batchRef = generateBatchReference();

  // Create the settlement batch
  runSql(
    `INSERT INTO settlements (batch_reference, status, created_at, created_by, total_transactions, notes)
     VALUES (?, 'draft', ?, ?, ?, ?)`,
    [batchRef, now, userId, transactionIds.length, notes || null]
  );

  const settlement = queryOne(
    'SELECT * FROM settlements WHERE batch_reference = ?',
    [batchRef]
  ) as Settlement;

  if (!settlement) {
    return { batch: null, error: 'فشل في إنشاء دفعة التسوية' };
  }

  // Link transactions to the batch
  let totalUsd = 0;
  for (const txId of transactionIds) {
    const tx = queryOne('SELECT * FROM transactions WHERE id = ?', [txId]);

    runSql(
      `INSERT INTO settlement_transactions (settlement_id, transaction_id, settlement_status, added_at)
       VALUES (?, ?, 'pending', ?)`,
      [settlement.id, txId, now]
    );

    // Update transaction with batch reference
    runSql(
      'UPDATE transactions SET settlement_batch_id = ? WHERE id = ?',
      [settlement.id, txId]
    );

    totalUsd += tx?.final_amount || tx?.amount_requested || 0;
  }

  // Update batch totals
  runSql(
    'UPDATE settlements SET total_usd_amount = ? WHERE id = ?',
    [totalUsd, settlement.id]
  );

  saveDb();

  return {
    batch: queryOne('SELECT * FROM settlements WHERE id = ?', [settlement.id]) as Settlement,
  };
}

/**
 * Get settlement batch details with transactions
 */
export function getSettlementBatchDetails(batchId: number): {
  batch: Settlement | null;
  transactions: any[];
} {
  const batch = queryOne('SELECT * FROM settlements WHERE id = ?', [batchId]) as Settlement | null;
  if (!batch) return { batch: null, transactions: [] };

  const transactions = queryAll(
    `SELECT st.*, t.reference, t.companyId, t.amount_requested, t.final_amount,
            t.deposit_type, t.today, t.transfer_exchange_rate, t.cash_exchange_rate,
            t.settlement_stage, t.approved, t.processed, t.rejected,
            t.lyd_payment_status, t.usd_payment_status
     FROM settlement_transactions st
     JOIN transactions t ON t.id = st.transaction_id
     WHERE st.settlement_id = ?
     ORDER BY st.added_at DESC`,
    [batchId]
  );

  return { batch, transactions };
}

/**
 * List settlement batches with summaries
 */
export function listSettlementBatches(options: {
  status?: SettlementBatchStatus;
  page?: number;
  limit?: number;
}): { batches: SettlementBatchSummary[]; total: number } {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];

  if (options.status) {
    conditions.push('s.status = ?');
    params.push(options.status);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countResult = queryOne(
    `SELECT COUNT(*) as count FROM settlements s ${whereClause}`,
    params
  ) as { count: number };

  const batches = queryAll(
    `SELECT s.*,
       (SELECT COUNT(*) FROM settlement_transactions st WHERE st.settlement_id = s.id AND st.settlement_status = 'pending') as pending_count,
       (SELECT COUNT(*) FROM settlement_transactions st WHERE st.settlement_id = s.id AND st.settlement_status = 'confirmed') as confirmed_count,
       (SELECT COUNT(*) FROM settlement_transactions st WHERE st.settlement_id = s.id AND st.settlement_status = 'settled') as settled_count
     FROM settlements s
     ${whereClause}
     ORDER BY s.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as SettlementBatchSummary[];

  return { batches, total: countResult?.count || 0 };
}

/**
 * Confirm USD for a batch (move matching transactions to confirmed)
 */
export function confirmBatchUSD(
  batchId: number,
  transactionIds: number[] | undefined,
  userId: number
): { success: boolean; confirmed: number; error?: string } {
  const batch = queryOne('SELECT * FROM settlements WHERE id = ?', [batchId]) as Settlement | null;
  if (!batch) return { success: false, confirmed: 0, error: 'الدفعة غير موجودة' };

  let toConfirm: any[];
  if (transactionIds && transactionIds.length > 0) {
    toConfirm = queryAll(
      `SELECT st.*, t.today, t.deposit_type, t.final_amount, t.amount_requested
       FROM settlement_transactions st
       JOIN transactions t ON t.id = st.transaction_id
       WHERE st.settlement_id = ? AND st.settlement_status = 'pending' AND st.transaction_id IN (${transactionIds.map(() => '?').join(',')})`,
      [batchId, ...transactionIds]
    );
  } else {
    toConfirm = queryAll(
      `SELECT st.*, t.today, t.deposit_type, t.final_amount, t.amount_requested
       FROM settlement_transactions st
       JOIN transactions t ON t.id = st.transaction_id
       WHERE st.settlement_id = ? AND st.settlement_status = 'pending'`,
      [batchId]
    );
  }

  let confirmed = 0;
  for (const stx of toConfirm) {
    const txDate = stx.today || new Date().toISOString().slice(0, 10);
    const sellRate = getSellRate(txDate);
    const centralRate = getCentralBankRate(txDate);
    const usdAmount = stx.final_amount || stx.amount_requested || 0;
    const profit = stx.deposit_type === 'cash' ? 0 : calculateProfit(usdAmount, sellRate, centralRate);

    runSql(
      `UPDATE settlement_transactions SET settlement_status = 'confirmed', profit_calculated = ?, sell_rate_used = ?, central_rate_used = ?
       WHERE id = ?`,
      [profit, sellRate, centralRate, stx.id]
    );

    // Advance transaction stage to usd_confirmed
    transitionStage(stx.transaction_id, 'usd_confirmed', userId, 'تأكيد USD في الدفعة');
    confirmed++;
  }

  // Update batch status to active if first confirmation
  if (batch.status === 'draft') {
    runSql("UPDATE settlements SET status = 'active' WHERE id = ?", [batchId]);
  }

  saveDb();
  return { success: true, confirmed };
}

/**
 * Confirm LYD for a batch
 */
export function confirmBatchLYD(
  batchId: number,
  transactionIds: number[] | undefined,
  userId: number
): { success: boolean; confirmed: number; error?: string } {
  const batch = queryOne('SELECT * FROM settlements WHERE id = ?', [batchId]) as Settlement | null;
  if (!batch) return { success: false, confirmed: 0, error: 'الدفعة غير موجودة' };

  let toConfirm: any[];
  if (transactionIds && transactionIds.length > 0) {
    toConfirm = queryAll(
      `SELECT st.* FROM settlement_transactions st
       WHERE st.settlement_id = ? AND st.settlement_status = 'confirmed' AND st.transaction_id IN (${transactionIds.map(() => '?').join(',')})`,
      [batchId, ...transactionIds]
    );
  } else {
    toConfirm = queryAll(
      `SELECT st.* FROM settlement_transactions st
       WHERE st.settlement_id = ? AND st.settlement_status = 'confirmed'`,
      [batchId]
    );
  }

  let confirmed = 0;
  for (const stx of toConfirm) {
    transitionStage(stx.transaction_id, 'lyd_confirmed', userId, 'تأكيد LYD في الدفعة');
    confirmed++;
  }

  saveDb();
  return { success: true, confirmed };
}

/**
 * Finalize a settlement batch
 */
export function finalizeBatch(
  batchId: number,
  userId: number
): { success: boolean; error?: string } {
  const batch = queryOne('SELECT * FROM settlements WHERE id = ?', [batchId]) as Settlement | null;
  if (!batch) return { success: false, error: 'الدفعة غير موجودة' };

  // Get all confirmed transactions
  const confirmedTxs = queryAll(
    `SELECT st.* FROM settlement_transactions st
     WHERE st.settlement_id = ? AND st.settlement_status = 'confirmed'`,
    [batchId]
  );

  if (confirmedTxs.length === 0) {
    return { success: false, error: 'لا توجد معاملات مؤكدة للتسوية' };
  }

  const now = new Date().toISOString();
  let totalProfit = 0;
  let totalLyd = 0;

  for (const stx of confirmedTxs) {
    // Mark as settled
    runSql(
      "UPDATE settlement_transactions SET settlement_status = 'settled' WHERE id = ?",
      [stx.id]
    );

    // Advance transaction stages
    transitionStage(stx.transaction_id, 'settled', userId, 'إنهاء التسوية');
    transitionStage(stx.transaction_id, 'profit_calculated', userId, 'تم حساب الربح');

    totalProfit += stx.profit_calculated || 0;

    // Calculate LYD settled
    const tx = queryOne('SELECT * FROM transactions WHERE id = ?', [stx.transaction_id]);
    const usdAmount = tx?.final_amount || tx?.amount_requested || 0;
    const sellRate = stx.sell_rate_used || 0;
    totalLyd += usdAmount * sellRate;

    // Create ledger entries
    runSql(
      `INSERT INTO settlement_ledger (settlement_id, entry_type, account_type, amount, currency, description, reference, entry_date, created_at, created_by)
       VALUES (?, 'debit', 'company_settlement', ?, 'USD', ?, ?, ?, ?, ?)`,
      [batchId, usdAmount, `تسوية USD - ${tx?.reference}`, tx?.reference, now, now, userId]
    );

    runSql(
      `INSERT INTO settlement_ledger (settlement_id, entry_type, account_type, amount, currency, description, reference, entry_date, created_at, created_by)
       VALUES (?, 'credit', 'bank_revenue', ?, 'LYD', ?, ?, ?, ?, ?)`,
      [batchId, stx.profit_calculated || 0, `ربح التسوية - ${tx?.reference}`, tx?.reference, now, now, userId]
    );
  }

  // Update batch as completed
  runSql(
    `UPDATE settlements SET status = 'completed', completed_at = ?, completed_by = ?, total_profit = ?, total_lyd_settled = ?
     WHERE id = ?`,
    [now, userId, totalProfit, totalLyd, batchId]
  );

  saveDb();
  return { success: true };
}

/**
 * Get stage history for a transaction
 */
export function getTransactionStageHistory(transactionId: number): any[] {
  return queryAll(
    `SELECT ssh.*, u.username as transitioned_by_name
     FROM settlement_stage_history ssh
     LEFT JOIN users u ON u.id = ssh.transitioned_by
     WHERE ssh.transaction_id = ?
     ORDER BY ssh.transitioned_at ASC`,
    [transactionId]
  );
}

/**
 * Get ledger entries for a settlement batch
 */
export function getSettlementLedger(settlementId: number): any[] {
  return queryAll(
    `SELECT * FROM settlement_ledger
     WHERE settlement_id = ?
     ORDER BY entry_date ASC, id ASC`,
    [settlementId]
  );
}

/**
 * Add a transaction to an existing draft batch
 */
export function addTransactionToBatch(
  batchId: number,
  transactionId: number
): { success: boolean; error?: string } {
  const batch = queryOne('SELECT * FROM settlements WHERE id = ?', [batchId]) as Settlement | null;
  if (!batch) return { success: false, error: 'الدفعة غير موجودة' };
  if (batch.status !== 'draft') return { success: false, error: 'لا يمكن الإضافة إلا لدفعة في حالة مسودة' };

  const tx = queryOne('SELECT * FROM transactions WHERE id = ?', [transactionId]);
  if (!tx) return { success: false, error: 'المعاملة غير موجودة' };
  if (tx.settlement_batch_id) return { success: false, error: 'المعاملة مضافة بالفعل لدفعة أخرى' };

  const now = new Date().toISOString();

  runSql(
    `INSERT INTO settlement_transactions (settlement_id, transaction_id, settlement_status, added_at)
     VALUES (?, ?, 'pending', ?)`,
    [batchId, transactionId, now]
  );

  runSql(
    'UPDATE transactions SET settlement_batch_id = ? WHERE id = ?',
    [batchId, transactionId]
  );

  // Update batch totals
  const usdAmount = tx.final_amount || tx.amount_requested || 0;
  runSql(
    `UPDATE settlements SET total_transactions = total_transactions + 1, total_usd_amount = total_usd_amount + ? WHERE id = ?`,
    [usdAmount, batchId]
  );

  saveDb();
  return { success: true };
}

/**
 * Remove a transaction from a draft batch
 */
export function removeTransactionFromBatch(
  batchId: number,
  transactionId: number
): { success: boolean; error?: string } {
  const batch = queryOne('SELECT * FROM settlements WHERE id = ?', [batchId]) as Settlement | null;
  if (!batch) return { success: false, error: 'الدفعة غير موجودة' };
  if (batch.status !== 'draft') return { success: false, error: 'لا يمكن الحذف إلا من دفعة في حالة مسودة' };

  const stx = queryOne(
    'SELECT * FROM settlement_transactions WHERE settlement_id = ? AND transaction_id = ?',
    [batchId, transactionId]
  );
  if (!stx) return { success: false, error: 'المعاملة غير موجودة في هذه الدفعة' };

  runSql(
    'DELETE FROM settlement_transactions WHERE settlement_id = ? AND transaction_id = ?',
    [batchId, transactionId]
  );

  runSql(
    'UPDATE transactions SET settlement_batch_id = NULL WHERE id = ?',
    [transactionId]
  );

  const tx = queryOne('SELECT * FROM transactions WHERE id = ?', [transactionId]);
  const usdAmount = tx?.final_amount || tx?.amount_requested || 0;
  runSql(
    `UPDATE settlements SET total_transactions = total_transactions - 1, total_usd_amount = total_usd_amount - ? WHERE id = ?`,
    [usdAmount, batchId]
  );

  saveDb();
  return { success: true };
}
