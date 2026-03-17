import { Router, Request, Response } from 'express';
import { queryAll, queryOne } from '../db/instance.js';
import { verifyAuth, AuthUser } from '../middleware/auth.js';
import * as XLSX from 'xlsx';

const router = Router();

interface Transaction {
  [key: string]: any;
}

interface TransactionsQuery {
  page?: string;
  limit?: string;
  status?: string;
  typeCode?: string;
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
  depositType?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

interface TransactionsResponse {
  records: Transaction[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}

function buildWhereClause(
  user: AuthUser | undefined,
  filters: Record<string, any>
): { clause: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];

  // Force company_user to only see their company's data
  if (user?.role === 'company_user' && user?.companyId) {
    conditions.push('companyId = ?');
    params.push(user.companyId);
  } else if (filters.companyId) {
    conditions.push('companyId = ?');
    params.push(filters.companyId);
  }

  if (filters.typeCode) {
    conditions.push('type_code = ?');
    params.push(filters.typeCode);
  }

  if (filters.depositType) {
    conditions.push('deposit_type = ?');
    params.push(filters.depositType);
  }

  if (filters.dateFrom) {
    conditions.push('today >= ?');
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push('today <= ?');
    params.push(filters.dateTo);
  }

  if (filters.search) {
    const searchTerm = `%${filters.search}%`;
    conditions.push('(reference LIKE ? OR iban LIKE ? OR customerId LIKE ?)');
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const clause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  return { clause, params };
}

router.get(
  '/',
  verifyAuth,
  (req: Request<{}, {}, {}, TransactionsQuery>, res: Response<TransactionsResponse>): void => {
    try {
      const page = Math.max(1, parseInt(req.query.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
      const offset = (page - 1) * limit;

      const { clause, params } = buildWhereClause(req.user, {
        companyId: req.query.companyId,
        typeCode: req.query.typeCode,
        depositType: req.query.depositType,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        search: req.query.search,
      });

      // Get total count
      const countQuery = `SELECT COUNT(*) as count FROM transactions ${clause}`;
      const countResult = queryOne(countQuery, params) as { count: number };
      const total = countResult?.count || 0;

      // Get records
      let orderBy = 'timestamp DESC';
      if (req.query.sortBy) {
        const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
        const validColumns = [
          'reference',
          'amount_requested',
          'final_amount',
          'timestamp',
          'today',
          'companyId',
          'type_code',
        ];
        if (validColumns.includes(req.query.sortBy)) {
          orderBy = `${req.query.sortBy} ${sortOrder}`;
        }
      }

      const query = `
        SELECT * FROM transactions
        ${clause}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `;

      const records = queryAll(query, [...params, limit, offset]) as Transaction[];

      // Filter by status if requested
      if (req.query.status) {
        const filtered = records.filter(r => r.computed_status === req.query.status);
        res.json({
          records: filtered,
          total: filtered.length,
          page,
          totalPages: Math.ceil(filtered.length / limit),
          limit,
        });
      } else {
        res.json({
          records,
          total,
          page,
          totalPages: Math.ceil(total / limit),
          limit,
        });
      }
    } catch (err) {
      console.error('Error fetching transactions:', err);
      res.status(500).json({
        error: 'Internal server error',
      } as any);
    }
  }
);

// ============================================================
// Export routes MUST be defined BEFORE /:reference
// to prevent Express from matching "export" as a reference param
// ============================================================

router.get(
  '/export/csv',
  verifyAuth,
  (req: Request<{}, {}, {}, TransactionsQuery>, res: Response): void => {
    try {
      const { clause, params } = buildWhereClause(req.user, {
        companyId: req.query.companyId,
        typeCode: req.query.typeCode,
        depositType: req.query.depositType,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        search: req.query.search,
      });

      const query = `SELECT * FROM transactions ${clause} ORDER BY timestamp DESC`;
      const records = queryAll(query, params) as Transaction[];

      // CSV headers - 33 columns
      const headers = [
        'Reference',
        'Contract',
        'Date',
        'Amount Requested',
        'Final Amount',
        'Type',
        'Available Balance',
        'IBAN',
        'UUID',
        'Account ID',
        'Current Account ID',
        'Margin Account ID',
        'Customer ID',
        'Company ID',
        'Deposit Type',
        'LYD FT',
        'USD FT',
        'AC Charge',
        'Transfer Exchange Rate',
        'Cash Exchange Rate',
        'FCMS Rate',
        'Approved At',
        'Created At',
        'Today',
        'LYD Payment Status',
        'USD Payment Status',
        'AC Charge Status',
        'Error 1',
        'Error 2',
        'Approved',
        'Processed',
        'Rejected',
        'Status',
      ];

      // Escape CSV values
      const escapeCSV = (value: any): string => {
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      };

      // Build CSV content
      const csvLines: string[] = [headers.join(',')];
      for (const record of records) {
        const row = [
          record.reference,
          record.contract,
          record.today,
          record.amount_requested,
          record.final_amount,
          record.type_code,
          record.availableBalance,
          record.iban,
          record.uuid,
          record.accountId,
          record.company_current_accountId,
          record.company_margin_accountId,
          record.customerId,
          record.companyId,
          record.deposit_type,
          record.lyd_ft,
          record.usd_ft,
          record.ac_charge,
          record.transfer_exchange_rate,
          record.cash_exchange_rate,
          record.fcms_rate,
          record.approved_at,
          record.created_at_original,
          record.today,
          record.lyd_payment_status,
          record.usd_payment_status,
          record.ac_charge_status,
          record.error1,
          record.error2,
          record.approved,
          record.processed,
          record.rejected,
          record.computed_status,
        ].map(escapeCSV);
        csvLines.push(row.join(','));
      }

      const csv = csvLines.join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
      res.send(csv);
    } catch (err) {
      console.error('Error exporting transactions:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============================================================
// Export approved transfer orders as Excel (xlsx format)
// Only includes: approved=1, deposit_type=transfer (excludes cash)
// Format: Single column with reference numbers matching bank format
// ============================================================
router.get(
  '/export/excel',
  verifyAuth,
  (req: Request<{}, {}, {}, TransactionsQuery>, res: Response): void => {
    try {
      const { clause, params } = buildWhereClause(req.user, {
        companyId: req.query.companyId,
        typeCode: req.query.typeCode,
        depositType: req.query.depositType,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        search: req.query.search,
      });

      // Build filter: approved transfer orders only (exclude cash)
      let filterClause = clause;
      const filterParams = [...params];

      if (filterClause) {
        filterClause += " AND approved = '1' AND deposit_type = 'transfer'";
      } else {
        filterClause = "WHERE approved = '1' AND deposit_type = 'transfer'";
      }

      const query = `SELECT reference FROM transactions ${filterClause} ORDER BY timestamp DESC`;
      const records = queryAll(query, filterParams) as Array<{ reference: string }>;

      // Build XLSX with single column: reference
      const data = [['reference'], ...records.map(r => [r.reference])];
      const ws = XLSX.utils.aoa_to_sheet(data);

      // Set column width
      ws['!cols'] = [{ wch: 40 }];

      // Bold header
      if (ws['A1']) {
        ws['A1'].s = { font: { bold: true } };
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Tablib Dataset');

      const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const timestamp = new Date().toISOString().split('T')[0];

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="SerafaPaymentQueue-${timestamp}.xlsx"`);
      res.send(Buffer.from(xlsxBuffer));
    } catch (err) {
      console.error('Error exporting Excel:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// /:reference MUST come AFTER /export/* routes
router.get(
  '/:reference',
  verifyAuth,
  (req: Request<{ reference: string }>, res: Response): void => {
    try {
      const { reference } = req.params;

      const query = 'SELECT * FROM transactions WHERE reference = ?';
      const transaction = queryOne(query, [reference]) as Transaction | null;

      if (!transaction) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      // Check authorization for company_user
      if (req.user?.role === 'company_user' && transaction.companyId !== req.user.companyId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      res.json(transaction);
    } catch (err) {
      console.error('Error fetching transaction:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
