import { Router, Request, Response } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../db/instance.js';
import { verifyAuth, requireRole } from '../middleware/auth.js';
import bcryptjs from 'bcryptjs';

const router = Router();

// ============ ADMIN: Get all users ============
router.get(
  '/',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const users = queryAll(
        'SELECT id, username, role, company_id, created_at FROM users ORDER BY id'
      );
      res.json(users);
    } catch (err) {
      console.error('Error fetching users:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============ ADMIN: Create new user ============
router.post(
  '/',
  verifyAuth,
  requireRole('bank_admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { username, password, role, companyId } = req.body;

      if (!username || !password || !role) {
        res.status(400).json({ error: 'اسم المستخدم وكلمة المرور والدور مطلوبة' });
        return;
      }

      if (!['bank_admin', 'company_user'].includes(role)) {
        res.status(400).json({ error: 'الدور غير صالح' });
        return;
      }

      if (role === 'company_user' && !companyId) {
        res.status(400).json({ error: 'معرف الشركة مطلوب لمستخدم الشركة' });
        return;
      }

      // Check if username already exists
      const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
      if (existing) {
        res.status(409).json({ error: 'اسم المستخدم موجود بالفعل' });
        return;
      }

      const passwordHash = await bcryptjs.hash(password, 12);
      const now = new Date().toISOString();

      runSql(
        'INSERT INTO users (username, password_hash, role, company_id, created_at) VALUES (?, ?, ?, ?, ?)',
        [username, passwordHash, role, role === 'company_user' ? companyId : null, now]
      );
      saveDb();

      const newUser = queryOne(
        'SELECT id, username, role, company_id, created_at FROM users WHERE username = ?',
        [username]
      );

      res.status(201).json(newUser);
    } catch (err) {
      console.error('Error creating user:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============ ADMIN: Delete user ============
router.delete(
  '/:id',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const { id } = req.params;

      // Prevent deleting self
      if (req.user && req.user.id === parseInt(id)) {
        res.status(400).json({ error: 'لا يمكنك حذف حسابك' });
        return;
      }

      const user = queryOne('SELECT id FROM users WHERE id = ?', [id]);
      if (!user) {
        res.status(404).json({ error: 'المستخدم غير موجود' });
        return;
      }

      runSql('DELETE FROM users WHERE id = ?', [id]);
      saveDb();

      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting user:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============ SELF: Change own password (any user) ============
// NOTE: Must be BEFORE /:id/password to avoid Express matching "me" as :id
router.put(
  '/me/password',
  verifyAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'كلمة المرور الحالية والجديدة مطلوبة' });
        return;
      }

      if (newPassword.length < 6) {
        res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        return;
      }

      const user = queryOne('SELECT * FROM users WHERE id = ?', [req.user!.id]) as any;
      if (!user) {
        res.status(404).json({ error: 'المستخدم غير موجود' });
        return;
      }

      const match = await bcryptjs.compare(currentPassword, user.password_hash);
      if (!match) {
        res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
        return;
      }

      const passwordHash = await bcryptjs.hash(newPassword, 12);
      runSql('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user!.id]);
      saveDb();

      res.json({ success: true });
    } catch (err) {
      console.error('Error changing password:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============ ADMIN: Reset user password ============
router.put(
  '/:id/password',
  verifyAuth,
  requireRole('bank_admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        return;
      }

      const user = queryOne('SELECT id FROM users WHERE id = ?', [id]);
      if (!user) {
        res.status(404).json({ error: 'المستخدم غير موجود' });
        return;
      }

      const passwordHash = await bcryptjs.hash(newPassword, 12);
      runSql('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
      saveDb();

      res.json({ success: true });
    } catch (err) {
      console.error('Error resetting password:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============ ADMIN: Get unique company IDs from transactions ============
router.get(
  '/companies/list',
  verifyAuth,
  requireRole('bank_admin'),
  (req: Request, res: Response): void => {
    try {
      const companies = queryAll(
        'SELECT DISTINCT companyId FROM transactions WHERE companyId IS NOT NULL ORDER BY companyId'
      );
      res.json(companies.map((c: any) => c.companyId));
    } catch (err) {
      console.error('Error fetching companies:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
