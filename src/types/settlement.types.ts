// ============================================================
// FILE: src/types/settlement.types.ts
// RESPONSIBILITY: All interfaces, types, enums for Settlement module
// IMPORTS FROM: nothing
// DO NOT ADD: logic, database queries, HTTP handling
// ============================================================

/** Raw transaction row from the database */
export interface TransactionRow {
  id: number;
  reference: string;
  companyId: string;
  type_code: string | null;
  amount_requested: number | null;
  final_amount: number | null;
  deposit_type: string | null;
  transfer_exchange_rate: number | null;
  cash_exchange_rate: number | null;
  fcms_rate: number | null;
  approved: number | null;
  processed: number | null;
  rejected: number | null;
  lyd_payment_status: number | null;
  usd_payment_status: number | null;
  error1: string | null;
  error2: string | null;
  today: string | null;
  [key: string]: any;
}

/** Analyzed settlement result for a single transaction */
export interface SettlementResult {
  reference: string;
  company_id: string;
  transaction_type: string;
  execution_channel: string;
  requested_amount: number;
  executed_amount: number;
  actual_execution_rate: number;
  purchase_rate: number;
  spread_per_unit: number;
  gross_margin: number;
  settlement_status: SettlementStatus;
  decision_reason: string;
  errors_detected: string[];
  review_flags: string[];
  stored_rate: number | null;
}

/** Possible settlement statuses */
export type SettlementStatus =
  | 'Ready for Settlement'
  | 'Pending Review'
  | 'Rejected from Settlement';

/** Execution channel types */
export type ExecutionChannel = 'transfer' | 'cash' | 'fcms' | 'unknown';

/** Settlement amounts breakdown */
export interface SettlementAmounts {
  amountUSD: number;
  amountLYD: number;
  isReviewNeeded: boolean;
  reason: string;
}

/** Settlement status decision */
export interface SettlementDecision {
  status: SettlementStatus;
  decision_reason: string;
  review_flags: string[];
}

/** Summary statistics for all analyzed transactions */
export interface SettlementSummary {
  total: number;
  ready: number;
  pending: number;
  rejected: number;
  totalMargin: number;
}

/** Query parameters for analyze endpoint */
export interface AnalyzeQueryParams {
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
  purchaseRate?: string;
  page?: string;
  limit?: string;
}

/** Pagination info */
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Full response from analyze endpoint */
export interface SettlementAnalyzeResponse {
  summary: SettlementSummary;
  results: SettlementResult[];
  pagination: PaginationInfo;
}

/** Parsed and validated query params for service layer */
export interface AnalyzeParams {
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
  purchaseRate: number;
  page: number;
  limit: number;
  useHistorical: boolean;
}
