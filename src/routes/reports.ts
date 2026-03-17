import { Router, Request, Response } from 'express';
import { queryAll } from '../db/instance.js';
import { verifyAuth, requireRole } from '../middleware/auth.js';

const router = Router();

interface DailyReport {
  date: string;
  totalTransactions: number;
  totalAmount: number;
  completedCount: number;
  failedCount: number;
  successRate: number;
}

interface ExchangeRateStats {
  date: string;
  avgRate: number;
  minRate: number;
  maxRate: number;
  count: number;
}

interface CompanyComparison {
  companyId: string;
  totalTransactions: number;
  totalAmount: number;
  completedCount: number;
  failedCount: number;
  successRate: number;
  topDates: Array<{ date: string; count: number }>;
}

interface PlatformTopDate {
  date: string;
  count: number;
}

router.get('/daily', verifyAuth, (req: Request, res: Response<DailyReport[]>): void => {
  try {
    let query = `
      SELECT
        today,
        COUNT(*) as totalTransactions,
        SUM(amount_requested) as totalAmount,
        SUM(CASE WHEN computed_status = 'completed' THEN 1 ELSE 0 END) as completedCount,
        SUM(CASE WHEN computed_status IN ('rejected', 'insufficient', 't24_error') THEN 1 ELSE 0 END) as failedCount
      FROM transactions
    `;

    const params: any[] = [];

    // If company_user, scope to their company
    if (req.user?.role === 'company_user' && req.user?.companyId) {
      query += ' WHERE companyId = ?';
      params.push(req.user.companyId);
    }

    query += ' GROUP BY today ORDER BY today DESC';

    const records = queryAll(query, params) as any[];

    const reports: DailyReport[] = records.map(record => {
      const successRate =
        record.totalTransactions > 0
          ? (record.completedCount / record.totalTransactions) * 100
          : 0;

      return {
        date: record.today,
        totalTransactions: record.totalTransactions,
        totalAmount: parseFloat((record.totalAmount || 0).toFixed(2)),
        completedCount: record.completedCount,
        failedCount: record.failedCount,
        successRate: parseFloat(successRate.toFixed(2)),
      };
    });

    res.json(reports);
  } catch (err) {
    console.error('Error fetching daily reports:', err);
    res.status(500).json({
      error: 'Internal server error',
    } as any);
  }
});

router.get(
  '/exchange-rates',
  verifyAuth,
  (req: Request, res: Response<ExchangeRateStats[]>): void => {
    try {
      let query = `
        SELECT
          today,
          AVG(transfer_exchange_rate) as avgRate,
          MIN(transfer_exchange_rate) as minRate,
          MAX(transfer_exchange_rate) as maxRate,
          COUNT(*) as count
        FROM transactions
        WHERE transfer_exchange_rate IS NOT NULL AND transfer_exchange_rate > 0
      `;

      const params: any[] = [];

      // If company_user, scope to their company
      if (req.user?.role === 'company_user' && req.user?.companyId) {
        query += ' AND companyId = ?';
        params.push(req.user.companyId);
      }

      query += ' GROUP BY today ORDER BY today DESC';

      const records = queryAll(query, params) as any[];

      const stats: ExchangeRateStats[] = records.map(record => ({
        date: record.today,
        avgRate: parseFloat((record.avgRate || 0).toFixed(4)),
        minRate: parseFloat((record.minRate || 0).toFixed(4)),
        maxRate: parseFloat((record.maxRate || 0).toFixed(4)),
        count: record.count,
      }));

      res.json(stats);
    } catch (err) {
      console.error('Error fetching exchange rate stats:', err);
      res.status(500).json({
        error: 'Internal server error',
      } as any);
    }
  }
);

router.get(
  '/companies',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const query = `
        SELECT
          companyId,
          COUNT(*) as totalTransactions,
          SUM(amount_requested) as totalAmount,
          SUM(CASE WHEN computed_status = 'completed' THEN 1 ELSE 0 END) as completedCount,
          SUM(CASE WHEN computed_status IN ('rejected', 'insufficient', 't24_error') THEN 1 ELSE 0 END) as failedCount
        FROM transactions
        WHERE companyId IS NOT NULL AND companyId != ''
        GROUP BY companyId
        ORDER BY totalTransactions DESC
      `;

      const records = queryAll(query) as any[];

      const comparisons: CompanyComparison[] = records.map(record => {
        const successRate =
          record.totalTransactions > 0
            ? (record.completedCount / record.totalTransactions) * 100
            : 0;

        // Get top dates for this company (dates with most orders)
        const topDatesQuery = `
          SELECT today as date, COUNT(*) as count
          FROM transactions
          WHERE companyId = ? AND today IS NOT NULL AND today != ''
          GROUP BY today
          ORDER BY count DESC
          LIMIT 5
        `;
        const topDatesRows = queryAll(topDatesQuery, [record.companyId]) as Array<{ date: string; count: number }>;

        return {
          companyId: record.companyId,
          totalTransactions: record.totalTransactions,
          totalAmount: parseFloat((record.totalAmount || 0).toFixed(2)),
          completedCount: record.completedCount,
          failedCount: record.failedCount,
          successRate: parseFloat(successRate.toFixed(2)),
          topDates: topDatesRows,
        };
      });

      // Platform-wide top dates
      const platformTopDatesQuery = `
        SELECT today as date, COUNT(*) as count
        FROM transactions
        WHERE today IS NOT NULL AND today != ''
        GROUP BY today
        ORDER BY count DESC
        LIMIT 5
      `;
      const platformTopDates = queryAll(platformTopDatesQuery) as PlatformTopDate[];

      res.json({ companies: comparisons, platformTopDates });
    } catch (err) {
      console.error('Error fetching company comparison:', err);
      res.status(500).json({
        error: 'Internal server error',
      } as any);
    }
  }
);

export default router;
