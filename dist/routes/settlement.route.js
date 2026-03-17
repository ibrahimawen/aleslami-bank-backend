// ============================================================
// FILE: src/routes/settlement.route.ts
// RESPONSIBILITY: Route definitions for Settlement module
// IMPORTS FROM: controllers, middleware
// DO NOT ADD: business logic, database queries, CSV building
// ============================================================
import { Router } from 'express';
import { verifyAuth, requireRole } from '../middleware/auth.js';
import { handleAnalyze, handleExport } from '../controllers/settlement.controller.js';
const router = Router();
/** GET /api/settlement/analyze — Run settlement analysis with pagination */
router.get('/analyze', verifyAuth, requireRole('bank_admin'), handleAnalyze);
/** GET /api/settlement/export — Export settlement analysis as CSV */
router.get('/export', verifyAuth, requireRole('bank_admin'), handleExport);
export default router;
