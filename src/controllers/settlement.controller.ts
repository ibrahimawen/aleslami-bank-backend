// ============================================================
// FILE: src/controllers/settlement.controller.ts
// RESPONSIBILITY: Extract inputs, call services, build HTTP responses
// IMPORTS FROM: services, validators, types
// DO NOT ADD: business logic, direct database queries
// ============================================================

import { Request, Response } from 'express';
import { validateAnalyzeParams } from '../validators/settlement.validator.js';
import { runSettlementAnalysis, getSettlementExportData } from '../services/settlement.service.js';
import { AnalyzeQueryParams, SettlementResult } from '../types/settlement.types.js';

/**
 * Handles GET /api/settlement/analyze — runs settlement analysis with pagination.
 */
export function handleAnalyze(
  req: Request<{}, {}, {}, AnalyzeQueryParams>,
  res: Response
): void {
  try {
    const params = validateAnalyzeParams(req.query);
    const result = runSettlementAnalysis(params);
    res.json(result);
  } catch (err: any) {
    console.error('Error analyzing settlement:', err);
    res.status(err.message?.includes('must be') ? 400 : 500).json({
      error: err.message || 'Internal server error',
    });
  }
}

/**
 * Handles GET /api/settlement/export — exports settlement analysis as CSV.
 */
export function handleExport(
  req: Request<{}, {}, {}, AnalyzeQueryParams>,
  res: Response
): void {
  try {
    const params = validateAnalyzeParams(req.query);
    const results = getSettlementExportData(params);

    const csv = buildCsv(results);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="settlement-analysis.csv"');
    res.send(csv);
  } catch (err: any) {
    console.error('Error exporting settlement:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── CSV builder (presentation concern, belongs in controller) ──

const CSV_HEADERS = [
  'Reference', 'Company ID', 'Transaction Type', 'Execution Channel',
  'Requested Amount (USD)', 'Executed Amount (LYD)', 'Selling Rate',
  'Purchase Rate (CBL)', 'Spread', 'Gross Margin (LYD)',
  'Settlement Status', 'Decision Reason', 'Errors Detected', 'Review Flags',
];

/**
 * Escapes a value for CSV format.
 */
function escapeCsv(value: any): string {
  if (value === null || value === undefined) return '';
  const str = Array.isArray(value) ? value.join('; ') : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds a full CSV string from settlement results.
 */
function buildCsv(results: SettlementResult[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')];

  for (const r of results) {
    const row = [
      r.reference, r.company_id, r.transaction_type, r.execution_channel,
      r.requested_amount, r.executed_amount, r.actual_execution_rate,
      r.purchase_rate, r.spread_per_unit, r.gross_margin,
      r.settlement_status, r.decision_reason,
      r.errors_detected, r.review_flags,
    ].map(escapeCsv);
    lines.push(row.join(','));
  }

  return lines.join('\n');
}
