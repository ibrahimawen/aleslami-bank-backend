// ============================================================
// FILE: src/services/settlement.service.ts
// RESPONSIBILITY: All business logic for Settlement analysis
// IMPORTS FROM: repositories, types, utils
// DO NOT ADD: HTTP handling (req/res), route definitions
// ============================================================
import { findTransactions, findHistoricalRate } from '../repositories/settlement.repository.js';
// ── Failure keywords for rejection ──────────────────────────
const FAILURE_KEYWORDS = [
    'insufficient', 'failed', 'unauthorised',
    'INPUT MISSING', 'Document Expiry', 'inactive', 'dormant',
];
// ── Internal helpers ────────────────────────────────────────
/**
 * Checks if error fields contain any failure indicator keywords.
 */
function hasFailureIndicators(error1, error2) {
    const combined = [error1 || '', error2 || ''].join(' ').toLowerCase();
    return FAILURE_KEYWORDS.some(kw => combined.includes(kw.toLowerCase()));
}
/**
 * Determines execution channel from deposit_type field.
 */
function determineChannel(tx) {
    if (tx.deposit_type === 'cash')
        return 'cash';
    if (tx.deposit_type === 'transfer')
        return 'transfer';
    if (tx.fcms_rate && tx.fcms_rate > 0)
        return 'fcms';
    return 'unknown';
}
/**
 * Gets the actual selling rate based on execution channel.
 */
function getActualRate(tx, channel) {
    if (channel === 'cash')
        return tx.cash_exchange_rate || 0;
    if (channel === 'transfer')
        return tx.transfer_exchange_rate || 0;
    if (channel === 'fcms')
        return tx.fcms_rate || 0;
    return 0;
}
/**
 * Checks if a transaction looks completed based on status flags.
 */
function isTransactionCompleted(tx) {
    return ((tx.approved === 1 || tx.processed === 1) &&
        (tx.lyd_payment_status === 1 || tx.usd_payment_status === 1));
}
/**
 * Validates transaction eligibility for settlement.
 */
function validateEligibility(tx) {
    const errors = [];
    if (tx.rejected === 1) {
        errors.push('Transaction marked as rejected');
        return { isEligible: false, errors };
    }
    if (hasFailureIndicators(tx.error1, tx.error2)) {
        errors.push(`Error indicators: ${[tx.error1, tx.error2].filter(Boolean).join(', ')}`);
        return { isEligible: false, errors };
    }
    if ((!tx.final_amount || tx.final_amount === 0) && !isTransactionCompleted(tx)) {
        errors.push('No final amount and transaction not completed');
        return { isEligible: false, errors };
    }
    return { isEligible: true, errors };
}
/**
 * Determines settlement amounts in USD and LYD.
 * amount_requested = المبلغ بالدولار (USD)
 * final_amount = المبلغ المنفذ بالدينار (LYD)
 */
function determineSettlementAmounts(tx) {
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
 * Calculates profit margin in LYD.
 * الربح = (سعر البيع - سعر المركزي) × المبلغ بالدولار
 * Cash transactions always return 0 profit.
 */
function calculateMargin(amountUSD, sellingRate, purchaseRate) {
    if (!sellingRate || sellingRate <= 0 || !amountUSD || amountUSD <= 0)
        return 0;
    const spread = sellingRate - purchaseRate;
    if (spread <= 0)
        return 0;
    return amountUSD * spread;
}
/**
 * Determines the final settlement status and decision reason.
 */
function determineSettlementDecision(tx, actualRate, amounts, validationErrors) {
    if (validationErrors.length > 0) {
        return {
            status: 'Rejected from Settlement',
            decision_reason: validationErrors[0],
            review_flags: validationErrors,
        };
    }
    if (amounts.isReviewNeeded) {
        return {
            status: 'Pending Review',
            decision_reason: amounts.reason,
            review_flags: [amounts.reason],
        };
    }
    const flags = [];
    if (!tx.approved && !tx.processed)
        flags.push('Not approved or processed');
    if (!actualRate || actualRate === 0)
        flags.push('Missing or zero exchange rate');
    if (flags.length > 0) {
        return { status: 'Pending Review', decision_reason: 'Partial data present', review_flags: flags };
    }
    return { status: 'Ready for Settlement', decision_reason: 'All required data present', review_flags: [] };
}
/**
 * Analyzes a single transaction and returns the settlement result.
 */
function analyzeTransaction(tx, purchaseRate, useHistorical) {
    let effectiveRate = purchaseRate;
    let storedRate = null;
    if (useHistorical && tx.today) {
        const historical = findHistoricalRate(tx.today);
        if (historical !== null) {
            effectiveRate = historical;
            storedRate = historical;
        }
    }
    const { isEligible, errors } = validateEligibility(tx);
    let status = 'Rejected from Settlement';
    let decision_reason = 'Transaction does not meet settlement criteria';
    let review_flags = [];
    let channel = 'unknown';
    let actualRate = 0;
    let amountUSD = 0;
    let amountLYD = 0;
    let grossMargin = 0;
    if (isEligible) {
        channel = determineChannel(tx);
        actualRate = getActualRate(tx, channel);
        const amounts = determineSettlementAmounts(tx);
        amountUSD = amounts.amountUSD;
        amountLYD = amounts.amountLYD;
        // الربح = (سعر البيع - سعر المركزي) × المبلغ بالدولار | النقدي = 0
        grossMargin = channel === 'cash' ? 0 : calculateMargin(amountUSD, actualRate, effectiveRate);
        const decision = determineSettlementDecision(tx, actualRate, amounts, []);
        status = decision.status;
        decision_reason = decision.decision_reason;
        review_flags = decision.review_flags;
    }
    const spread = (actualRate > 0 && actualRate > effectiveRate) ? actualRate - effectiveRate : 0;
    return {
        reference: tx.reference,
        company_id: tx.companyId,
        transaction_type: tx.type_code || 'Unknown',
        execution_channel: channel,
        requested_amount: amountUSD,
        executed_amount: amountLYD,
        actual_execution_rate: actualRate,
        purchase_rate: effectiveRate,
        spread_per_unit: parseFloat(spread.toFixed(4)),
        gross_margin: parseFloat(grossMargin.toFixed(2)),
        settlement_status: status,
        decision_reason,
        errors_detected: errors,
        review_flags,
        stored_rate: storedRate,
    };
}
// ── Public API ──────────────────────────────────────────────
/**
 * Runs settlement analysis: fetches transactions, analyzes each, builds summary and paginated results.
 */
export function runSettlementAnalysis(params) {
    const transactions = findTransactions({
        companyId: params.companyId,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
    });
    const allResults = transactions.map(tx => analyzeTransaction(tx, params.purchaseRate, params.useHistorical));
    // الربح يحتسب فقط على حوالات غير مرفوضة
    const profitableResults = allResults.filter(r => r.settlement_status !== 'Rejected from Settlement' && r.execution_channel !== 'cash');
    const summary = {
        total: allResults.length,
        ready: allResults.filter(r => r.settlement_status === 'Ready for Settlement').length,
        pending: allResults.filter(r => r.settlement_status === 'Pending Review').length,
        rejected: allResults.filter(r => r.settlement_status === 'Rejected from Settlement').length,
        totalMargin: profitableResults.reduce((sum, r) => sum + r.gross_margin, 0),
    };
    const startIdx = (params.page - 1) * params.limit;
    const paginatedResults = allResults.slice(startIdx, startIdx + params.limit);
    return {
        summary,
        results: paginatedResults,
        pagination: {
            page: params.page,
            limit: params.limit,
            total: allResults.length,
            totalPages: Math.ceil(allResults.length / params.limit),
        },
    };
}
/**
 * Runs settlement analysis and returns all results (no pagination) for CSV export.
 */
export function getSettlementExportData(params) {
    const transactions = findTransactions({
        companyId: params.companyId,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
    });
    return transactions.map(tx => analyzeTransaction(tx, params.purchaseRate, params.useHistorical));
}
