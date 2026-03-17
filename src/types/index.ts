// ============================================
// Settlement Stage Types
// ============================================

export type SettlementStage =
  | 'created'
  | 'approved'
  | 'usd_confirmed'
  | 'lyd_confirmed'
  | 'settled'
  | 'profit_calculated';

export const SETTLEMENT_STAGES: SettlementStage[] = [
  'created',
  'approved',
  'usd_confirmed',
  'lyd_confirmed',
  'settled',
  'profit_calculated',
];

export const STAGE_LABELS: Record<SettlementStage, string> = {
  created: 'تم الإنشاء',
  approved: 'معتمدة',
  usd_confirmed: 'USD مؤكد',
  lyd_confirmed: 'LYD مؤكد',
  settled: 'تمت التسوية',
  profit_calculated: 'تم حساب الربح',
};

// ============================================
// Settlement Batch Types
// ============================================

export type SettlementBatchStatus = 'draft' | 'active' | 'completed' | 'archived';

export interface Settlement {
  id: number;
  batch_reference: string;
  status: SettlementBatchStatus;
  created_at: string;
  created_by: number;
  completed_at: string | null;
  completed_by: number | null;
  total_transactions: number;
  total_usd_amount: number;
  total_lyd_settled: number;
  total_profit: number;
  notes: string | null;
}

export interface SettlementTransaction {
  id: number;
  settlement_id: number;
  transaction_id: number;
  settlement_status: 'pending' | 'confirmed' | 'rejected' | 'settled';
  profit_calculated: number;
  sell_rate_used: number | null;
  central_rate_used: number | null;
  added_at: string;
}

// ============================================
// Settlement Ledger Types
// ============================================

export type LedgerEntryType = 'debit' | 'credit';

export interface LedgerEntry {
  id: number;
  settlement_id: number;
  entry_type: LedgerEntryType;
  account_type: string;
  amount: number;
  currency: string;
  description: string | null;
  reference: string | null;
  entry_date: string;
  created_at: string;
  created_by: number | null;
}

// ============================================
// Exchange Rate Types
// ============================================

export type RateType = 'central_bank_rate' | 'sell_rate' | 'transfer_rate' | 'cash_rate' | 'settlement_rate';

export interface DailyRateSet {
  id: number;
  effective_date: string;
  central_bank_rate: number;
  sell_rate: number | null;
  transfer_rate: number | null;
  cash_rate: number | null;
  settlement_rate: number | null;
  created_at: string;
  created_by: number | null;
  updated_at: string | null;
  updated_by: number | null;
  notes: string | null;
}

export interface CreateDailyRateRequest {
  effective_date: string;
  central_bank_rate: number;
  sell_rate?: number;
  transfer_rate?: number;
  cash_rate?: number;
  settlement_rate?: number;
  notes?: string;
}

// ============================================
// Stage History Types
// ============================================

export interface StageTransition {
  id: number;
  transaction_id: number;
  from_stage: SettlementStage | null;
  to_stage: SettlementStage;
  transitioned_at: string;
  transitioned_by: number | null;
  reason: string | null;
}

// ============================================
// API Request/Response Types
// ============================================

export interface CreateSettlementRequest {
  transaction_ids: number[];
  notes?: string;
}

export interface AdvanceStageRequest {
  to_stage: SettlementStage;
  reason?: string;
}

export interface ConfirmBatchRequest {
  transaction_ids?: number[]; // optional subset; if empty, all pending in batch
}

export interface SettlementAnalysisSummary {
  total: number;
  ready: number;
  pending: number;
  rejected: number;
  totalMargin: number;
}

export interface SettlementBatchSummary {
  id: number;
  batch_reference: string;
  status: SettlementBatchStatus;
  created_at: string;
  total_transactions: number;
  total_usd_amount: number;
  total_profit: number;
  pending_count: number;
  confirmed_count: number;
  settled_count: number;
}
