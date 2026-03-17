import { queryAll, queryOne, runSql, saveDb } from '../db/instance.js';
import { DailyRateSet, CreateDailyRateRequest } from '../types/index.js';

const DEFAULT_CENTRAL_RATE = 7.38;

/**
 * Get the applicable rate set for a given date
 * Falls back to the most recent rate before the date
 */
export function getRateSetForDate(date: string): DailyRateSet | null {
  const rate = queryOne(
    `SELECT * FROM exchange_rates_daily
     WHERE effective_date <= ?
     ORDER BY effective_date DESC LIMIT 1`,
    [date]
  ) as DailyRateSet | null;
  return rate;
}

/**
 * Get the applicable rate based on deposit type and date
 */
export function getApplicableRate(depositType: string, date: string): number {
  const rateSet = getRateSetForDate(date);
  if (!rateSet) return DEFAULT_CENTRAL_RATE;

  switch (depositType) {
    case 'transfer':
      return rateSet.transfer_rate || rateSet.sell_rate || rateSet.central_bank_rate;
    case 'cash':
      return rateSet.cash_rate || rateSet.sell_rate || rateSet.central_bank_rate;
    default:
      return rateSet.sell_rate || rateSet.central_bank_rate;
  }
}

/**
 * Get the central bank rate for a date
 */
export function getCentralBankRate(date: string): number {
  const rateSet = getRateSetForDate(date);
  return rateSet?.central_bank_rate || DEFAULT_CENTRAL_RATE;
}

/**
 * Get the sell rate for a date
 */
export function getSellRate(date: string): number {
  const rateSet = getRateSetForDate(date);
  return rateSet?.sell_rate || rateSet?.central_bank_rate || DEFAULT_CENTRAL_RATE;
}

/**
 * Calculate profit using the correct formula:
 * Profit = (sell_rate - central_bank_rate) × usd_amount
 */
export function calculateProfit(usdAmount: number, sellRate: number, centralBankRate: number): number {
  if (!usdAmount || usdAmount <= 0 || !sellRate || sellRate <= 0) return 0;
  const spread = sellRate - centralBankRate;
  if (spread <= 0) return 0;
  return parseFloat((usdAmount * spread).toFixed(2));
}

/**
 * Validate a rate value (positive number, max 4 decimal places)
 */
export function validateRate(value: number): boolean {
  if (typeof value !== 'number' || isNaN(value)) return false;
  if (value <= 0) return false;
  // Check max 4 decimal places
  const str = value.toString();
  const decimalIndex = str.indexOf('.');
  if (decimalIndex !== -1 && str.length - decimalIndex - 1 > 4) return false;
  return true;
}

/**
 * Create or update a daily rate set
 */
export function upsertDailyRates(data: CreateDailyRateRequest, userId: number): DailyRateSet {
  const now = new Date().toISOString();

  // Check if rate exists for this date
  const existing = queryOne(
    'SELECT * FROM exchange_rates_daily WHERE effective_date = ?',
    [data.effective_date]
  );

  if (existing) {
    // Update
    runSql(
      `UPDATE exchange_rates_daily SET
        central_bank_rate = ?,
        sell_rate = ?,
        transfer_rate = ?,
        cash_rate = ?,
        settlement_rate = ?,
        updated_at = ?,
        updated_by = ?,
        notes = ?
      WHERE effective_date = ?`,
      [
        data.central_bank_rate,
        data.sell_rate || null,
        data.transfer_rate || null,
        data.cash_rate || null,
        data.settlement_rate || null,
        now,
        userId,
        data.notes || null,
        data.effective_date,
      ]
    );
  } else {
    // Insert
    runSql(
      `INSERT INTO exchange_rates_daily
        (effective_date, central_bank_rate, sell_rate, transfer_rate, cash_rate, settlement_rate, created_at, created_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.effective_date,
        data.central_bank_rate,
        data.sell_rate || null,
        data.transfer_rate || null,
        data.cash_rate || null,
        data.settlement_rate || null,
        now,
        userId,
        data.notes || null,
      ]
    );
  }

  saveDb();

  // Also sync to legacy purchase_rates table for backward compatibility
  runSql(
    `INSERT OR REPLACE INTO purchase_rates (rate, effective_date, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [data.central_bank_rate, data.effective_date, data.notes || null, userId, now]
  );
  saveDb();

  return queryOne(
    'SELECT * FROM exchange_rates_daily WHERE effective_date = ?',
    [data.effective_date]
  ) as DailyRateSet;
}

/**
 * Get rate history with pagination
 */
export function getRateHistory(options: {
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}): { rates: DailyRateSet[]; total: number; page: number; limit: number } {
  const page = options.page || 1;
  const limit = options.limit || 30;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];

  if (options.dateFrom) {
    conditions.push('effective_date >= ?');
    params.push(options.dateFrom);
  }
  if (options.dateTo) {
    conditions.push('effective_date <= ?');
    params.push(options.dateTo);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countResult = queryOne(
    `SELECT COUNT(*) as count FROM exchange_rates_daily ${whereClause}`,
    params
  ) as { count: number };

  const rates = queryAll(
    `SELECT * FROM exchange_rates_daily ${whereClause} ORDER BY effective_date DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as DailyRateSet[];

  return {
    rates,
    total: countResult?.count || 0,
    page,
    limit,
  };
}

/**
 * Get all rates (no pagination) for export
 */
export function getAllRates(dateFrom?: string, dateTo?: string): DailyRateSet[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (dateFrom) {
    conditions.push('effective_date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push('effective_date <= ?');
    params.push(dateTo);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  return queryAll(
    `SELECT * FROM exchange_rates_daily ${whereClause} ORDER BY effective_date DESC`,
    params
  ) as DailyRateSet[];
}
