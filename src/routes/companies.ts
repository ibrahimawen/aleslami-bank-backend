import { Router, Request, Response } from 'express';
import { queryAll } from '../db/instance.js';
import { verifyAuth, requireRole } from '../middleware/auth.js';

const router = Router();

interface ContractInfo {
  contractId: string;
  totalOrders: number;
  transferCount: number;
  cashCount: number;
  rejectedCount: number;
  totalUSD: number;
  totalLYD: number;
}

interface CompanyStats {
  companyId: string;
  totalRequests: number;
  totalAmount: number;         // total USD
  totalAmountLYD: number;      // total LYD reserved
  completedCount: number;
  failedCount: number;
  transferCount: number;
  cashCount: number;
  successRate: number;
  totalProfit: number;
  contracts: ContractInfo[];
}

function calcRecordProfit(record: any): number {
  if (record.deposit_type === 'transfer' && record.amount_requested && record.final_amount) {
    return record.final_amount - record.amount_requested;
  }
  return 0;
}

router.get(
  '/',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request<{}, {}, {}, { purchaseRate?: string }>, res: Response): void => {
    try {
      // Get all unique company IDs
      const companiesQuery = `
        SELECT DISTINCT companyId FROM transactions
        WHERE companyId IS NOT NULL AND companyId != ''
        ORDER BY companyId
      `;

      const companies = queryAll(companiesQuery) as Array<{ companyId: string }>;

      const stats: CompanyStats[] = [];

      for (const { companyId } of companies) {
        const recordsQuery = `
          SELECT * FROM transactions WHERE companyId = ?
        `;
        const records = queryAll(recordsQuery, [companyId]) as any[];

        const totalRequests = records.length;
        const totalAmount = records.reduce((sum, r) => sum + (r.amount_requested || 0), 0);
        const totalAmountLYD = records.reduce((sum, r) => sum + (r.final_amount || 0), 0);
        const completedCount = records.filter(r => r.computed_status === 'completed').length;
        const failedCount = records.filter(
          r =>
            r.computed_status === 'rejected' ||
            r.computed_status === 'insufficient' ||
            r.computed_status === 't24_error'
        ).length;
        const transferCount = records.filter(r => r.deposit_type === 'transfer').length;
        const cashCount = records.filter(r => r.deposit_type === 'cash').length;
        const successRate = totalRequests > 0 ? (completedCount / totalRequests) * 100 : 0;
        const totalProfit = records.reduce((sum, r) => sum + calcRecordProfit(r), 0);

        // Group by contract
        const contractMap: Record<string, ContractInfo> = {};
        for (const r of records) {
          const cid = r.contract || '';
          if (!cid) continue;
          if (!contractMap[cid]) {
            contractMap[cid] = {
              contractId: cid,
              totalOrders: 0,
              transferCount: 0,
              cashCount: 0,
              rejectedCount: 0,
              totalUSD: 0,
              totalLYD: 0,
            };
          }
          contractMap[cid].totalOrders++;
          contractMap[cid].totalUSD += (r.amount_requested || 0);
          contractMap[cid].totalLYD += (r.final_amount || 0);
          if (r.deposit_type === 'transfer') contractMap[cid].transferCount++;
          if (r.deposit_type === 'cash') contractMap[cid].cashCount++;
          if (r.computed_status === 'rejected' || r.computed_status === 'insufficient' || r.computed_status === 't24_error') {
            contractMap[cid].rejectedCount++;
          }
        }

        const contracts = Object.values(contractMap).sort((a, b) => b.totalUSD - a.totalUSD);

        stats.push({
          companyId,
          totalRequests,
          totalAmount: parseFloat(totalAmount.toFixed(2)),
          totalAmountLYD: parseFloat(totalAmountLYD.toFixed(2)),
          completedCount,
          failedCount,
          transferCount,
          cashCount,
          successRate: parseFloat(successRate.toFixed(2)),
          totalProfit: parseFloat(totalProfit.toFixed(2)),
          contracts,
        });
      }

      res.json(stats);
    } catch (err) {
      console.error('Error fetching companies:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.get(
  '/:id',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request<{ id: string }>, res: Response): void => {
    try {
      const { id } = req.params;

      const recordsQuery = `
        SELECT * FROM transactions WHERE companyId = ? ORDER BY timestamp DESC
      `;
      const records = queryAll(recordsQuery, [id]) as any[];

      if (records.length === 0) {
        res.status(404).json({ error: 'Company not found' });
        return;
      }

      const totalRequests = records.length;
      const totalAmount = records.reduce((sum, r) => sum + (r.amount_requested || 0), 0);
      const totalAmountLYD = records.reduce((sum, r) => sum + (r.final_amount || 0), 0);
      const completedCount = records.filter(r => r.computed_status === 'completed').length;
      const failedCount = records.filter(
        r =>
          r.computed_status === 'rejected' ||
          r.computed_status === 'insufficient' ||
          r.computed_status === 't24_error'
      ).length;
      const transferCount = records.filter(r => r.deposit_type === 'transfer').length;
      const cashCount = records.filter(r => r.deposit_type === 'cash').length;
      const successRate = totalRequests > 0 ? (completedCount / totalRequests) * 100 : 0;
      const totalProfit = records.reduce((sum, r) => sum + calcRecordProfit(r), 0);

      res.json({
        companyId: id,
        totalRequests,
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        totalAmountLYD: parseFloat(totalAmountLYD.toFixed(2)),
        completedCount,
        failedCount,
        transferCount,
        cashCount,
        successRate: parseFloat(successRate.toFixed(2)),
        totalProfit: parseFloat(totalProfit.toFixed(2)),
        records,
      });
    } catch (err) {
      console.error('Error fetching company details:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
