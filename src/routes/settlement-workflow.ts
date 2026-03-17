import { Router, Request, Response } from 'express';
import { verifyAuth, requireRole } from '../middleware/auth.js';
import {
  createSettlementBatch,
  getSettlementBatchDetails,
  listSettlementBatches,
  confirmBatchUSD,
  confirmBatchLYD,
  finalizeBatch,
  transitionStage,
  bulkTransitionStage,
  getTransactionStageHistory,
  getSettlementLedger,
  addTransactionToBatch,
  removeTransactionFromBatch,
} from '../services/settlement-service.js';
import { SettlementStage, SettlementBatchStatus } from '../types/index.js';

const router = Router();

// ============================================
// Settlement Batch Endpoints
// ============================================

/**
 * POST /api/settlement/batch - Create a new settlement batch
 */
router.post(
  '/batch',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const { transaction_ids, notes } = req.body;
      const userId = req.user?.id || 0;

      const result = createSettlementBatch(transaction_ids, userId, notes);

      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.status(201).json(result.batch);
    } catch (err) {
      console.error('Error creating settlement batch:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/settlement/batches - List settlement batches
 */
router.get(
  '/batches',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const status = req.query.status as SettlementBatchStatus | undefined;
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = parseInt((req.query.limit as string) || '20', 10);

      const result = listSettlementBatches({ status, page, limit });
      res.json(result);
    } catch (err) {
      console.error('Error listing settlement batches:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/settlement/batches/:id - Get batch details with transactions
 */
router.get(
  '/batches/:id',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const batchId = parseInt(req.params.id, 10);
      const result = getSettlementBatchDetails(batchId);

      if (!result.batch) {
        res.status(404).json({ error: 'الدفعة غير موجودة' });
        return;
      }

      res.json(result);
    } catch (err) {
      console.error('Error getting batch details:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/settlement/batches/:id/add - Add transaction to batch
 */
router.post(
  '/batches/:id/add',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const batchId = parseInt(req.params.id, 10);
      const { transaction_id } = req.body;

      const result = addTransactionToBatch(batchId, transaction_id);
      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Error adding transaction to batch:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/settlement/batches/:id/remove - Remove transaction from batch
 */
router.post(
  '/batches/:id/remove',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const batchId = parseInt(req.params.id, 10);
      const { transaction_id } = req.body;

      const result = removeTransactionFromBatch(batchId, transaction_id);
      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Error removing transaction from batch:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============================================
// Stage Management Endpoints
// ============================================

/**
 * PUT /api/settlement/stage/:transactionId - Advance transaction stage
 */
router.put(
  '/stage/:transactionId',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const transactionId = parseInt(req.params.transactionId, 10);
      const { to_stage, reason } = req.body as { to_stage: SettlementStage; reason?: string };

      if (!to_stage) {
        res.status(400).json({ error: 'يجب تحديد المرحلة الجديدة' });
        return;
      }

      const userId = req.user?.id || 0;
      const result = transitionStage(transactionId, to_stage, userId, reason);

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Error advancing stage:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * PUT /api/settlement/stage-bulk - Bulk advance stages
 */
router.put(
  '/stage-bulk',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const { transaction_ids, to_stage, reason } = req.body;

      if (!transaction_ids || !Array.isArray(transaction_ids) || !to_stage) {
        res.status(400).json({ error: 'يجب تحديد المعاملات والمرحلة' });
        return;
      }

      const userId = req.user?.id || 0;
      const result = bulkTransitionStage(transaction_ids, to_stage, userId, reason);
      res.json(result);
    } catch (err) {
      console.error('Error bulk advancing stages:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/settlement/history/:transactionId - Get stage history
 */
router.get(
  '/history/:transactionId',
  verifyAuth,
  (req: Request, res: Response): void => {
    try {
      const transactionId = parseInt(req.params.transactionId, 10);
      const history = getTransactionStageHistory(transactionId);
      res.json(history);
    } catch (err) {
      console.error('Error getting stage history:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============================================
// Batch Confirmation Endpoints
// ============================================

/**
 * POST /api/settlement/batches/:id/confirm-usd - Confirm USD for batch
 */
router.post(
  '/batches/:id/confirm-usd',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const batchId = parseInt(req.params.id, 10);
      const { transaction_ids } = req.body;
      const userId = req.user?.id || 0;

      const result = confirmBatchUSD(batchId, transaction_ids, userId);

      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true, confirmed: result.confirmed });
    } catch (err) {
      console.error('Error confirming USD:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/settlement/batches/:id/confirm-lyd - Confirm LYD for batch
 */
router.post(
  '/batches/:id/confirm-lyd',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const batchId = parseInt(req.params.id, 10);
      const { transaction_ids } = req.body;
      const userId = req.user?.id || 0;

      const result = confirmBatchLYD(batchId, transaction_ids, userId);

      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true, confirmed: result.confirmed });
    } catch (err) {
      console.error('Error confirming LYD:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/settlement/batches/:id/finalize - Finalize settlement batch
 */
router.post(
  '/batches/:id/finalize',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const batchId = parseInt(req.params.id, 10);
      const userId = req.user?.id || 0;

      const result = finalizeBatch(batchId, userId);

      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Error finalizing batch:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============================================
// Ledger Endpoints
// ============================================

/**
 * GET /api/settlement/batches/:id/ledger - Get ledger entries for a batch
 */
router.get(
  '/batches/:id/ledger',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const batchId = parseInt(req.params.id, 10);
      const entries = getSettlementLedger(batchId);
      res.json(entries);
    } catch (err) {
      console.error('Error getting ledger:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
