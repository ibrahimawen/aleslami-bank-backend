import { Router, Request, Response } from 'express';
import { verifyAuth, requireRole } from '../middleware/auth.js';
import {
  upsertDailyRates,
  getRateHistory,
  getRateSetForDate,
  getAllRates,
  validateRate,
} from '../services/rate-service.js';
import { CreateDailyRateRequest } from '../types/index.js';

const router = Router();

/**
 * POST /api/rates/daily - Create or update daily rate set (bank_admin only)
 */
router.post(
  '/daily',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request<{}, {}, CreateDailyRateRequest>, res: Response): void => {
    try {
      const { effective_date, central_bank_rate, sell_rate, transfer_rate, cash_rate, settlement_rate, notes } = req.body;

      if (!effective_date || central_bank_rate === undefined) {
        res.status(400).json({ error: 'يجب تحديد التاريخ وسعر المركزي' });
        return;
      }

      if (!validateRate(central_bank_rate)) {
        res.status(400).json({ error: 'سعر المركزي غير صالح' });
        return;
      }

      // Validate optional rates
      const optionalRates = { sell_rate, transfer_rate, cash_rate, settlement_rate };
      for (const [key, value] of Object.entries(optionalRates)) {
        if (value !== undefined && value !== null && !validateRate(value as number)) {
          res.status(400).json({ error: `${key} غير صالح` });
          return;
        }
      }

      const userId = req.user?.id || 0;
      const result = upsertDailyRates(req.body, userId);

      res.status(201).json(result);
    } catch (err) {
      console.error('Error creating/updating daily rates:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/rates/daily - Get rates for a specific date
 */
router.get('/daily', verifyAuth, (req: Request, res: Response): void => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const rateSet = getRateSetForDate(date);

    if (!rateSet) {
      res.json({
        effective_date: null,
        central_bank_rate: 7.38,
        sell_rate: null,
        transfer_rate: null,
        cash_rate: null,
        settlement_rate: null,
        isDefault: true,
      });
      return;
    }

    res.json(rateSet);
  } catch (err) {
    console.error('Error fetching daily rates:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/rates/history - Get paginated rate history (new 5-type system)
 */
router.get(
  '/history',
  verifyAuth,
  (req: Request, res: Response): void => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = parseInt((req.query.limit as string) || '30', 10);

      const result = getRateHistory({ dateFrom, dateTo, page, limit });
      res.json(result);
    } catch (err) {
      console.error('Error fetching rate history:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/rates/for-date - Get applicable rates for a specific date
 */
router.get('/for-date', verifyAuth, (req: Request, res: Response): void => {
  try {
    const date = req.query.date as string;
    if (!date) {
      res.status(400).json({ error: 'يجب تحديد التاريخ' });
      return;
    }

    const rateSet = getRateSetForDate(date);
    if (!rateSet) {
      res.json({ rate: 7.38, effective_date: null, isDefault: true });
      return;
    }

    res.json(rateSet);
  } catch (err) {
    console.error('Error fetching rate for date:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/rates/export - Export rate history as CSV
 */
router.get(
  '/export',
  verifyAuth,
  (req: Request, res: Response): void => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;

      const rates = getAllRates(dateFrom, dateTo);

      const csvHeader = 'التاريخ,سعر المركزي,سعر البيع,سعر التحويل,سعر النقد,سعر التسوية,ملاحظات,تاريخ الإدخال\n';
      const csvRows = rates
        .map((rate: any) => {
          const escapeCSV = (val: any) => {
            if (val === null || val === undefined) return '';
            const str = String(val).replace(/"/g, '""');
            return str.includes(',') ? `"${str}"` : str;
          };
          return [
            rate.effective_date,
            rate.central_bank_rate,
            rate.sell_rate || '',
            rate.transfer_rate || '',
            rate.cash_rate || '',
            rate.settlement_rate || '',
            escapeCSV(rate.notes),
            rate.created_at,
          ].join(',');
        })
        .join('\n');

      const csv = csvHeader + csvRows;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="exchange-rates.csv"');
      res.send(csv);
    } catch (err) {
      console.error('Error exporting rates:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
