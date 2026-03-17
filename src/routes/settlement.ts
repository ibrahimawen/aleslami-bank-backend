import { Router, Request, Response } from 'express';
import { queryAll, queryOne } from '../db/instance.js';
import { verifyAuth, requireRole, AuthUser } from '../middleware/auth.js';

const router = Router();

interface Transaction {
  [key: string]: any;
}

interface SettlementAnalysisParams {
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
  purchaseRate?: string;  // سعر الشراء من المركزي (default: 7.38)
  page?: string;
  limit?: string;
}

interface SettlementResult {
  reference: string;
  company_id: string;
  transaction_type: string;
  execution_channel: string;
  requested_amount: number;
  executed_amount: number;
  actual_execution_rate: number;
  purchase_rate: number;      // سعر الشراء من المركزي
  spread_per_unit: number;    // الفرق بين سعر البيع وسعر الشراء
  gross_margin: number;       // الربح بالدينار = spread × المبلغ بالدولار
  settlement_status: string;
  decision_reason: string;
  errors_detected: string[];
  review_flags: string[];
  stored_rate: number | null; // the historical rate from the archive, if used
}

interface SettlementResponse {
  summary: {
    total: number;
    ready: number;
    pending: number;
    rejected: number;
    totalMargin: number;
  };
  results: SettlementResult[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Check if a transaction has failure indicators in error fields
 */
function hasFailureIndicators(error1: string | null, error2: string | null): boolean {
  const failureKeywords = [
    'insufficient',
    'failed',
    'unauthorised',
    'INPUT MISSING',
    'Document Expiry',
    'inactive',
    'dormant',
  ];

  const errors = [error1 || '', error2 || ''].join(' ').toLowerCase();
  return failureKeywords.some(keyword => errors.includes(keyword.toLowerCase()));
}

/**
 * Determine execution channel based on deposit type and rates
 */
function determineChannel(tx: Transaction): string {
  if (tx.deposit_type === 'cash') return 'cash';
  if (tx.deposit_type === 'transfer') return 'transfer';
  if (tx.fcms_rate && tx.fcms_rate > 0) return 'fcms';
  return 'unknown';
}

/**
 * Get the actual execution rate based on channel
 */
function getActualRate(tx: Transaction, channel: string): number {
  if (channel === 'cash') return tx.cash_exchange_rate || 0;
  if (channel === 'transfer') return tx.transfer_exchange_rate || 0;
  if (channel === 'fcms') return tx.fcms_rate || 0;
  return 0;
}

/**
 * Determine if transaction looks completed
 */
function isTransactionCompleted(tx: Transaction): boolean {
  return (
    (tx.approved === 1 || tx.processed === 1) &&
    (tx.lyd_payment_status === 1 || tx.usd_payment_status === 1)
  );
}

/**
 * Get historical rate for a transaction date
 */
function getHistoricalRate(txDate: string): number | null {
  try {
    const rate = queryOne(
      'SELECT rate FROM purchase_rates WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1',
      [txDate]
    );
    return rate ? rate.rate : null;
  } catch {
    return null;
  }
}

/**
 * Validate transaction eligibility for settlement
 */
function validateEligibility(
  tx: Transaction
): { isEligible: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check if rejected
  if (tx.rejected === 1) {
    errors.push('Transaction marked as rejected');
    return { isEligible: false, errors };
  }

  // Check for failure indicators in error fields
  if (hasFailureIndicators(tx.error1, tx.error2)) {
    errors.push(`Error indicators found: ${[tx.error1, tx.error2].filter(Boolean).join(', ')}`);
    return { isEligible: false, errors };
  }

  // Check if final_amount is 0 or null and transaction not completed
  if ((!tx.final_amount || tx.final_amount === 0) && !isTransactionCompleted(tx)) {
    errors.push('No final amount and transaction not completed');
    return { isEligible: false, errors };
  }

  return { isEligible: true, errors };
}

/**
 * Determine settlement amounts
 * amount_requested = المبلغ بالدولار (USD)
 * final_amount = المبلغ المنفذ بالدينار (LYD) = amount_requested × exchange_rate
 */
function determineSettlementAmounts(
  tx: Transaction,
  channel: string
): { amountUSD: number; amountLYD: number; isReviewNeeded: boolean; reason: string } {
  const amountUSD = tx.amount_requested || 0;
  const amountLYD = tx.final_amount || 0;

  if (amountUSD > 0 && (amountLYD > 0 || isTransactionCompleted(tx))) {
    return { amountUSD, amountLYD, isReviewNeeded: false, reason: 'OK' };
  }

  if (amountUSD <= 0) {
    return { amountUSD: 0, amountLYD: 0, isReviewNeeded: true, reason: 'Pending Review - No USD amount' };
  }

  return { amountUSD, amountLYD: 0, isReviewNeeded: true, reason: 'Pending Review - Insufficient data' };
}

/**
 * Calculate settlement margin (profit in LYD)
 * الربح = (سعر البيع للشركة - سعر الشراء من المركزي) × المبلغ بالدولار
 *
 * مثال:
 *   100,000$ مطلوب → 80,000$ منفذ (approved)
 *   50,000$ حوالة + 30,000$ نقدي
 *   سعر المركزي: 7.37 | سعر البيع: 7.45 | هامش: 0.08
 *   الربح = 50,000 × 0.08 = 4,000 LYD (حوالات فقط، النقدي لا يحتسب)
 */
function calculateMargin(amountUSD: number, sellingRate: number, purchaseRate: number): number {
  if (!sellingRate || sellingRate <= 0 || !amountUSD || amountUSD <= 0) return 0;
  const spreadPerUnit = sellingRate - purchaseRate;
  if (spreadPerUnit <= 0) return 0;
  return amountUSD * spreadPerUnit;
}

/**
 * Determine settlement status and decision reason
 */
function determineSettlementStatus(
  tx: Transaction,
  channel: string,
  actualRate: number,
  settlementAmount: { amountUSD: number; amountLYD: number; isReviewNeeded: boolean; reason: string },
  errors: string[]
): { status: string; decision_reason: string; review_flags: string[] } {
  const review_flags: string[] = [];

  // If validation failed, reject from settlement
  if (errors.length > 0) {
    return {
      status: 'Rejected from Settlement',
      decision_reason: errors[0],
      review_flags: errors,
    };
  }

  // Check for review flags
  if (settlementAmount.isReviewNeeded) {
    return {
      status: 'Pending Review',
      decision_reason: settlementAmount.reason,
      review_flags: [settlementAmount.reason],
    };
  }

  if (!tx.approved && !tx.processed) {
    review_flags.push('Not approved or processed');
  }

  if (!actualRate || actualRate === 0) {
    review_flags.push('Missing or zero exchange rate');
  }

  if (review_flags.length > 0) {
    return {
      status: 'Pending Review',
      decision_reason: 'Partial data present',
      review_flags,
    };
  }

  return {
    status: 'Ready for Settlement',
    decision_reason: 'All required data present',
    review_flags: [],
  };
}

/**
 * Run settlement analysis on a transaction
 */
function analyzeTransaction(
  tx: Transaction,
  purchaseRate: number = 7.37,
  useHistorical: boolean = false
): SettlementResult {
  let effectiveRate = purchaseRate;
  let storedRate: number | null = null;

  // If using historical rates and user didn't provide explicit rate, look up historical rate
  if (useHistorical && tx.today) {
    const historical = getHistoricalRate(tx.today);
    if (historical !== null) {
      effectiveRate = historical;
      storedRate = historical;
    }
  }

  // Step 1: Validate eligibility
  const { isEligible, errors } = validateEligibility(tx);
  const errors_detected: string[] = [...errors];

  let settlement_status = 'Rejected from Settlement';
  let decision_reason = 'Transaction does not meet settlement criteria';
  let review_flags: string[] = [];
  let execution_channel = 'unknown';
  let actual_rate = 0;
  let amountUSD = 0;
  let amountLYD = 0;
  let gross_margin = 0;

  if (isEligible) {
    // Step 2: Determine execution channel
    execution_channel = determineChannel(tx);

    // Step 3: Determine actual rate (sell rate)
    actual_rate = getActualRate(tx, execution_channel);

    // Step 4: Determine settlement amounts
    // amount_requested = USD | final_amount = LYD
    const settlementData = determineSettlementAmounts(tx, execution_channel);
    amountUSD = settlementData.amountUSD;
    amountLYD = settlementData.amountLYD;

    // Step 5: Calculate margin (profit in LYD)
    // الربح = (سعر البيع - سعر المركزي) × المبلغ بالدولار
    // النقدي (cash) لا يحتسب ربح
    if (execution_channel === 'cash') {
      gross_margin = 0;
    } else {
      gross_margin = calculateMargin(amountUSD, actual_rate, effectiveRate);
    }

    // Step 6: Final decision
    const decision = determineSettlementStatus(
      tx,
      execution_channel,
      actual_rate,
      settlementData,
      []
    );
    settlement_status = decision.status;
    decision_reason = decision.decision_reason;
    review_flags = decision.review_flags;
  }

  const spreadPerUnit = (actual_rate > 0 && actual_rate > effectiveRate) ? actual_rate - effectiveRate : 0;

  return {
    reference: tx.reference,
    company_id: tx.companyId,
    transaction_type: tx.type_code || 'Unknown',
    execution_channel,
    requested_amount: amountUSD,
    executed_amount: amountLYD,
    actual_execution_rate: actual_rate,
    purchase_rate: effectiveRate,
    spread_per_unit: parseFloat(spreadPerUnit.toFixed(4)),
    gross_margin: parseFloat(gross_margin.toFixed(2)),
    settlement_status,
    decision_reason,
    errors_detected,
    review_flags,
    stored_rate: storedRate,
  };
}

/**
 * GET /api/settlement/analyze
 * Analyze transactions for settlement
 */
router.get(
  '/analyze',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request<{}, {}, {}, SettlementAnalysisParams>, res: Response<SettlementResponse>): void => {
    try {
      const { companyId, dateFrom, dateTo, purchaseRate: purchaseRateStr, page: pageStr, limit: limitStr } = req.query;
      const purchaseRate = parseFloat(purchaseRateStr || '7.37');
      const page = Math.max(1, parseInt(pageStr || '1', 10));
      const limit = Math.max(1, parseInt(limitStr || '50', 10));

      // Build where clause
      const conditions: string[] = [];
      const queryParams: any[] = [];

      if (companyId) {
        conditions.push('companyId = ?');
        queryParams.push(companyId);
      }

      if (dateFrom) {
        conditions.push('today >= ?');
        queryParams.push(dateFrom);
      }

      if (dateTo) {
        conditions.push('today <= ?');
        queryParams.push(dateTo);
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      // Query ALL transactions for summary calculation and analysis
      const sqlQuery = `SELECT * FROM transactions ${whereClause} ORDER BY timestamp DESC`;
      const transactions = queryAll(sqlQuery, queryParams) as Transaction[];

      // Determine if we should use historical rates
      // Use historical if user didn't provide a rate or provided the default
      const userProvidedRate = purchaseRateStr !== undefined && purchaseRateStr !== '7.37';
      const useHistorical = !userProvidedRate;

      // Analyze ALL transactions to calculate summary statistics
      const results: SettlementResult[] = transactions.map(tx =>
        analyzeTransaction(tx, purchaseRate, useHistorical)
      );

      // Build summary from ALL results
      // الربح يحتسب فقط على المعاملات الجاهزة للتسوية + حوالات فقط (ليس نقدي)
      // المرفوضة والنقدي لا تدخل في حساب الأرباح
      const profitableResults = results.filter(r =>
        r.settlement_status !== 'Rejected from Settlement' &&
        r.execution_channel !== 'cash'
      );

      const summary = {
        total: results.length,
        ready: results.filter(r => r.settlement_status === 'Ready for Settlement').length,
        pending: results.filter(r => r.settlement_status === 'Pending Review').length,
        rejected: results.filter(r => r.settlement_status === 'Rejected from Settlement').length,
        totalMargin: profitableResults.reduce((sum, r) => sum + r.gross_margin, 0),
      };

      // Apply pagination: slice the analyzed results for the current page
      const startIdx = (page - 1) * limit;
      const endIdx = startIdx + limit;
      const paginatedResults = results.slice(startIdx, endIdx);

      // Calculate total pages
      const totalPages = Math.ceil(results.length / limit);

      res.json({
        summary,
        results: paginatedResults,
        pagination: {
          page,
          limit,
          total: results.length,
          totalPages,
        },
      });
    } catch (err) {
      console.error('Error analyzing settlement:', err);
      res.status(500).json({
        error: 'Internal server error',
      } as any);
    }
  }
);

/**
 * GET /api/settlement/export
 * Export settlement analysis as CSV
 */
router.get(
  '/export',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request<{}, {}, {}, SettlementAnalysisParams>, res: Response): void => {
    try {
      const { companyId, dateFrom, dateTo, purchaseRate: purchaseRateStr } = req.query;
      const purchaseRate = parseFloat(purchaseRateStr || '7.37');

      // Build where clause
      const conditions: string[] = [];
      const exportParams: any[] = [];

      if (companyId) {
        conditions.push('companyId = ?');
        exportParams.push(companyId);
      }

      if (dateFrom) {
        conditions.push('today >= ?');
        exportParams.push(dateFrom);
      }

      if (dateTo) {
        conditions.push('today <= ?');
        exportParams.push(dateTo);
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      // Query transactions
      const sqlQuery = `SELECT * FROM transactions ${whereClause} ORDER BY timestamp DESC`;
      const transactions = queryAll(sqlQuery, exportParams) as Transaction[];

      // Determine if we should use historical rates
      const userProvidedRate = purchaseRateStr !== undefined && purchaseRateStr !== '7.37';
      const useHistorical = !userProvidedRate;

      // Analyze each transaction with historical rate support
      const results: SettlementResult[] = transactions.map(tx =>
        analyzeTransaction(tx, purchaseRate, useHistorical)
      );

      // CSV headers
      const headers = [
        'Reference',
        'Company ID',
        'Transaction Type',
        'Execution Channel',
        'Requested Amount (USD)',
        'Executed Amount (USD)',
        'Selling Rate',
        'Purchase Rate (CBL)',
        'Spread',
        'Gross Margin (LYD)',
        'Settlement Status',
        'Decision Reason',
        'Errors Detected',
        'Review Flags',
      ];

      // Escape CSV values
      const escapeCSV = (value: any): string => {
        if (value === null || value === undefined) return '';
        const stringValue = Array.isArray(value) ? value.join('; ') : String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      };

      // Build CSV content
      const csvLines: string[] = [headers.join(',')];
      for (const result of results) {
        const row = [
          result.reference,
          result.company_id,
          result.transaction_type,
          result.execution_channel,
          result.requested_amount,
          result.executed_amount,
          result.actual_execution_rate,
          result.purchase_rate,
          result.spread_per_unit,
          result.gross_margin,
          result.settlement_status,
          result.decision_reason,
          result.errors_detected,
          result.review_flags,
        ].map(escapeCSV);
        csvLines.push(row.join(','));
      }

      const csv = csvLines.join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="settlement-analysis.csv"');
      res.send(csv);
    } catch (err) {
      console.error('Error exporting settlement analysis:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
