import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../db/instance.js';
import { verifyAuth, requireRole } from '../middleware/auth.js';
const router = Router();
// POST /api/rates - Create or update a rate (bank_admin only)
router.post('/', verifyAuth, requireRole('bank_admin'), (req, res) => {
    const { rate, effective_date, notes } = req.body;
    if (rate === undefined || !effective_date) {
        res.status(400).json({ error: 'Missing rate or effective_date' });
        return;
    }
    try {
        const userId = req.user?.id;
        const createdAt = new Date().toISOString();
        runSql(`INSERT OR REPLACE INTO purchase_rates (rate, effective_date, notes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`, [rate, effective_date, notes || null, userId || null, createdAt]);
        saveDb();
        const savedRate = queryOne('SELECT * FROM purchase_rates WHERE effective_date = ?', [effective_date]);
        res.status(201).json(savedRate);
    }
    catch (err) {
        console.error('Error creating/updating rate:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/rates/current - Get the most recent rate
router.get('/current', verifyAuth, (req, res) => {
    try {
        const rate = queryOne('SELECT * FROM purchase_rates ORDER BY effective_date DESC LIMIT 1');
        if (!rate) {
            res.json({ rate: 7.38, effective_date: null, isDefault: true });
            return;
        }
        res.json(rate);
    }
    catch (err) {
        console.error('Error fetching current rate:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/rates/history - Get paginated rate history
router.get('/history', verifyAuth, (req, res) => {
    try {
        const dateFrom = req.query.dateFrom || null;
        const dateTo = req.query.dateTo || null;
        const limit = parseInt(req.query.limit || '30', 10);
        const page = parseInt(req.query.page || '1', 10);
        const offset = (page - 1) * limit;
        let whereClause = '';
        const params = [];
        if (dateFrom && dateTo) {
            whereClause = 'WHERE effective_date BETWEEN ? AND ?';
            params.push(dateFrom, dateTo);
        }
        else if (dateFrom) {
            whereClause = 'WHERE effective_date >= ?';
            params.push(dateFrom);
        }
        else if (dateTo) {
            whereClause = 'WHERE effective_date <= ?';
            params.push(dateTo);
        }
        // Get total count
        const countQuery = `SELECT COUNT(*) as count FROM purchase_rates ${whereClause}`;
        const countResult = queryOne(countQuery, params);
        const total = countResult?.count || 0;
        // Get paginated results
        const ratesQuery = `
        SELECT * FROM purchase_rates
        ${whereClause}
        ORDER BY effective_date DESC
        LIMIT ? OFFSET ?
      `;
        const rates = queryAll(ratesQuery, [...params, limit, offset]);
        res.json({
            rates,
            total,
            page,
            limit,
        });
    }
    catch (err) {
        console.error('Error fetching rate history:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/rates/for-date - Get rate for a specific date
router.get('/for-date', verifyAuth, (req, res) => {
    try {
        const date = req.query.date;
        if (!date) {
            res.status(400).json({ error: 'Missing date parameter' });
            return;
        }
        const rate = queryOne(`SELECT * FROM purchase_rates
         WHERE effective_date <= ?
         ORDER BY effective_date DESC
         LIMIT 1`, [date]);
        if (!rate) {
            res.json({ rate: 7.38, effective_date: null, isDefault: true });
            return;
        }
        res.json(rate);
    }
    catch (err) {
        console.error('Error fetching rate for date:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/rates/export - Export rate history as CSV
router.get('/export', verifyAuth, (req, res) => {
    try {
        const dateFrom = req.query.dateFrom || null;
        const dateTo = req.query.dateTo || null;
        let whereClause = '';
        const params = [];
        if (dateFrom && dateTo) {
            whereClause = 'WHERE effective_date BETWEEN ? AND ?';
            params.push(dateFrom, dateTo);
        }
        else if (dateFrom) {
            whereClause = 'WHERE effective_date >= ?';
            params.push(dateFrom);
        }
        else if (dateTo) {
            whereClause = 'WHERE effective_date <= ?';
            params.push(dateTo);
        }
        const rates = queryAll(`SELECT * FROM purchase_rates ${whereClause} ORDER BY effective_date DESC`, params);
        // Build CSV with Arabic headers
        const csvHeader = 'التاريخ,سعر الشراء,ملاحظات,تاريخ الإدخال\n';
        const csvRows = rates
            .map((rate) => {
            const date = rate.effective_date || '';
            const rateValue = rate.rate || '';
            const notes = (rate.notes || '').replace(/"/g, '""'); // Escape quotes
            const createdAt = rate.created_at || '';
            return `"${date}","${rateValue}","${notes}","${createdAt}"`;
        })
            .join('\n');
        const csv = csvHeader + csvRows;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="purchase-rates.csv"');
        res.send(csv);
    }
    catch (err) {
        console.error('Error exporting rates:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
export default router;
