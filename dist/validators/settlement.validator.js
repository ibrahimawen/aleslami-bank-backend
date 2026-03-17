// ============================================================
// FILE: src/validators/settlement.validator.ts
// RESPONSIBILITY: Input validation for Settlement query params
// IMPORTS FROM: types/settlement.types.ts
// DO NOT ADD: business logic, database access, HTTP handling
// ============================================================
const DEFAULT_PURCHASE_RATE = 7.37;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
/**
 * Parses and validates the raw query parameters for settlement analysis.
 */
export function validateAnalyzeParams(raw) {
    const purchaseRateStr = raw.purchaseRate;
    const purchaseRate = parseFloat(purchaseRateStr || String(DEFAULT_PURCHASE_RATE));
    if (isNaN(purchaseRate) || purchaseRate <= 0) {
        throw new Error('purchaseRate must be a positive number');
    }
    const page = Math.max(1, parseInt(raw.page || String(DEFAULT_PAGE), 10));
    const limit = Math.max(1, Math.min(500, parseInt(raw.limit || String(DEFAULT_LIMIT), 10)));
    const userProvidedRate = purchaseRateStr !== undefined
        && purchaseRateStr !== String(DEFAULT_PURCHASE_RATE);
    const useHistorical = !userProvidedRate;
    return {
        companyId: raw.companyId || undefined,
        dateFrom: raw.dateFrom || undefined,
        dateTo: raw.dateTo || undefined,
        purchaseRate,
        page,
        limit,
        useHistorical,
    };
}
