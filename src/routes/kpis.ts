import { Router, Request, Response } from 'express';
import { queryAll, queryOne } from '../db/instance.js';
import { verifyAuth } from '../middleware/auth.js';

const router = Router();

interface KPIs {
  totalTransactions: number;
  totalAmount: number;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  avgExchangeRate: number;
  avgTransferRate: number;
  avgCashRate: number;
  totalProfit: number;
}

function calcRecordProfit(record: any): number {
  // Profit calculation: final_amount - amount_requested
  // Only for transfer deposits
  if (record.deposit_type === 'transfer' && record.amount_requested && record.final_amount) {
    return record.final_amount - record.amount_requested;
  }
  return 0;
}

router.get('/current', verifyAuth, (req: Request, res: Response<KPIs>): void => {
  try {
    let query = 'SELECT * FROM transactions WHERE 1=1';
    const params: any[] = [];

    // If company_user, scope to their company
    if (req.user?.role === 'company_user' && req.user?.companyId) {
      query += ' AND companyId = ?';
      params.push(req.user.companyId);
    }

    const records = queryAll(query, params) as any[];

    const totalTransactions = records.length;
    const totalAmount = records.reduce((sum, r) => sum + (r.amount_requested || 0), 0);
    const pendingCount = records.filter(
      r =>
        r.computed_status === 'pending' ||
        r.computed_status === 'approved' ||
        r.computed_status === 'charged'
    ).length;
    const completedCount = records.filter(r => r.computed_status === 'completed').length;
    const failedCount = records.filter(
      r =>
        r.computed_status === 'rejected' ||
        r.computed_status === 'insufficient' ||
        r.computed_status === 't24_error'
    ).length;

    // Calculate average exchange rates (transfer + cash separately)
    const companyFilter = params.length > 0 ? ' AND companyId = ?' : '';
    const rateParams = params.length > 0 ? [...params] : [];

    const transferRateResult = queryOne(
      `SELECT AVG(transfer_exchange_rate) as avg FROM transactions WHERE transfer_exchange_rate IS NOT NULL AND transfer_exchange_rate > 0${companyFilter}`,
      rateParams
    ) as { avg: number | null };

    const cashRateResult = queryOne(
      `SELECT AVG(cash_exchange_rate) as avg FROM transactions WHERE cash_exchange_rate IS NOT NULL AND cash_exchange_rate > 0${companyFilter}`,
      rateParams
    ) as { avg: number | null };

    const avgTransferRate = transferRateResult?.avg || 0;
    const avgCashRate = cashRateResult?.avg || 0;
    const avgExchangeRate = avgTransferRate || avgCashRate || 0;

    // Calculate total profit
    const totalProfit = records.reduce((sum, r) => sum + calcRecordProfit(r), 0);

    const kpis: KPIs = {
      totalTransactions,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      pendingCount,
      completedCount,
      failedCount,
      avgExchangeRate: parseFloat(avgExchangeRate.toFixed(4)),
      avgTransferRate: parseFloat(avgTransferRate.toFixed(4)),
      avgCashRate: parseFloat(avgCashRate.toFixed(4)),
      totalProfit: parseFloat(totalProfit.toFixed(2)),
    };

    res.json(kpis);
  } catch (err) {
    console.error('Error fetching KPIs:', err);
    res.status(500).json({
      error: 'Internal server error',
    } as any);
  }
});

export default router;
