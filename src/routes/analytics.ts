import { Router, Request, Response } from 'express';
import { queryAll, queryOne } from '../db/instance.js';
import { verifyAuth, requireRole } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/analytics/activity-heatmap
 * Returns daily transaction counts for calendar heatmap
 */
router.get(
  '/activity-heatmap',
  verifyAuth,
  (req: Request, res: Response): void => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;

      const conditions: string[] = ['today IS NOT NULL'];
      const params: any[] = [];

      // Company filter: company_user only sees their own company
      if (req.user?.role === 'company_user' && req.user?.companyId) {
        conditions.push('companyId = ?');
        params.push(req.user.companyId);
      } else if (companyId) {
        conditions.push('companyId = ?');
        params.push(companyId);
      }

      if (dateFrom) {
        conditions.push('today >= ?');
        params.push(dateFrom);
      }
      if (dateTo) {
        conditions.push('today <= ?');
        params.push(dateTo);
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const data = queryAll(
        `SELECT today as date, COUNT(*) as count, SUM(COALESCE(final_amount, amount_requested, 0)) as volume
         FROM transactions
         ${whereClause}
         GROUP BY today
         ORDER BY today ASC`,
        params
      );

      res.json(data);
    } catch (err) {
      console.error('Error fetching activity heatmap:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/analytics/volume-daily
 * Returns daily volume for charts
 */
router.get(
  '/volume-daily',
  verifyAuth,
  (req: Request, res: Response): void => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const limit = parseInt((req.query.limit as string) || '30', 10);

      const conditions: string[] = ['today IS NOT NULL'];
      const params: any[] = [];

      if (req.user?.role === 'company_user' && req.user?.companyId) {
        conditions.push('companyId = ?');
        params.push(req.user.companyId);
      } else if (companyId) {
        conditions.push('companyId = ?');
        params.push(companyId);
      }

      if (dateFrom) {
        conditions.push('today >= ?');
        params.push(dateFrom);
      }
      if (dateTo) {
        conditions.push('today <= ?');
        params.push(dateTo);
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const data = queryAll(
        `SELECT today as date,
                COUNT(*) as count,
                SUM(COALESCE(final_amount, amount_requested, 0)) as volume,
                SUM(CASE WHEN deposit_type = 'transfer' THEN 1 ELSE 0 END) as transfers,
                SUM(CASE WHEN deposit_type = 'cash' THEN 1 ELSE 0 END) as cash_count
         FROM transactions
         ${whereClause}
         GROUP BY today
         ORDER BY today DESC
         LIMIT ?`,
        [...params, limit]
      );

      res.json(data.reverse());
    } catch (err) {
      console.error('Error fetching daily volume:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/analytics/top-companies
 * Returns top companies by transaction volume or count
 */
router.get(
  '/top-companies',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const sortBy = (req.query.sortBy as string) || 'volume';
      const limit = parseInt((req.query.limit as string) || '10', 10);
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;

      const conditions: string[] = ['companyId IS NOT NULL'];
      const params: any[] = [];

      if (dateFrom) {
        conditions.push('today >= ?');
        params.push(dateFrom);
      }
      if (dateTo) {
        conditions.push('today <= ?');
        params.push(dateTo);
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const orderColumn = sortBy === 'count' ? 'tx_count' : 'total_volume';

      const data = queryAll(
        `SELECT companyId,
                COUNT(*) as tx_count,
                SUM(COALESCE(final_amount, amount_requested, 0)) as total_volume,
                SUM(CASE WHEN approved = 1 THEN 1 ELSE 0 END) as approved_count,
                SUM(CASE WHEN rejected = 1 THEN 1 ELSE 0 END) as rejected_count,
                MIN(today) as first_tx_date,
                MAX(today) as last_tx_date
         FROM transactions
         ${whereClause}
         GROUP BY companyId
         ORDER BY ${orderColumn} DESC
         LIMIT ?`,
        [...params, limit]
      );

      res.json(data);
    } catch (err) {
      console.error('Error fetching top companies:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/analytics/settlement-summary
 * Returns settlement batch statistics
 */
router.get(
  '/settlement-summary',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const totals = queryOne(
        `SELECT
           COUNT(*) as total_batches,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
           SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
           SUM(CASE WHEN status = 'completed' THEN total_profit ELSE 0 END) as total_revenue,
           SUM(CASE WHEN status = 'completed' THEN total_usd_amount ELSE 0 END) as total_usd_settled,
           SUM(CASE WHEN status = 'completed' THEN total_lyd_settled ELSE 0 END) as total_lyd_settled
         FROM settlements`
      );

      const recentBatches = queryAll(
        `SELECT * FROM settlements ORDER BY created_at DESC LIMIT 5`
      );

      res.json({
        summary: totals || {
          total_batches: 0, completed: 0, active: 0, draft: 0,
          total_revenue: 0, total_usd_settled: 0, total_lyd_settled: 0,
        },
        recentBatches,
      });
    } catch (err) {
      console.error('Error fetching settlement summary:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
