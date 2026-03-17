// ============================================================
// FILE: src/repositories/settlement.repository.ts
// RESPONSIBILITY: All database queries for Settlement module
// IMPORTS FROM: db/instance, types/settlement.types
// DO NOT ADD: business logic, HTTP handling, validation
// ============================================================
import { queryAll, queryOne } from '../db/instance.js';
/**
 * Finds all transactions matching the given filters, ordered by timestamp DESC.
 */
export function findTransactions(filters) {
    const conditions = [];
    const params = [];
    if (filters.companyId) {
        conditions.push('companyId = ?');
        params.push(filters.companyId);
    }
    if (filters.dateFrom) {
        conditions.push('today >= ?');
        params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
        conditions.push('today <= ?');
        params.push(filters.dateTo);
    }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const sql = `SELECT * FROM transactions ${where} ORDER BY timestamp DESC`;
    return queryAll(sql, params);
}
/**
 * Finds the historical purchase rate applicable to a given date.
 * Returns the most recent rate on or before that date, or null.
 */
export function findHistoricalRate(txDate) {
    try {
        const row = queryOne('SELECT rate FROM purchase_rates WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1', [txDate]);
        return row ? row.rate : null;
    }
    catch {
        return null;
    }
}
