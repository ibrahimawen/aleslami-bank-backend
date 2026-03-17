import { Router } from 'express';
import { loginUser, refreshAccessToken } from '../services/auth.js';
import { verifyAuth } from '../middleware/auth.js';
const router = Router();
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        res.status(400).json({ error: 'Missing username or password' });
        return;
    }
    try {
        const result = await loginUser(username, password);
        if (!result) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        res.json({
            accessToken: result.tokens.accessToken,
            refreshToken: result.tokens.refreshToken,
            user: result.user,
        });
    }
    catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/refresh', (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        res.status(400).json({ error: 'Missing refreshToken' });
        return;
    }
    const newAccessToken = refreshAccessToken(refreshToken);
    if (!newAccessToken) {
        res.status(401).json({ error: 'Invalid or expired refresh token' });
        return;
    }
    res.json({ accessToken: newAccessToken });
});
router.get('/me', verifyAuth, (req, res) => {
    res.json({
        user: req.user,
    });
});
// Auto-login endpoint — returns admin tokens without credentials (for desktop app)
router.get('/auto-login', async (_req, res) => {
    try {
        const result = await loginUser('admin', 'admin123');
        if (!result) {
            res.status(500).json({ error: 'Auto-login failed: admin user not found' });
            return;
        }
        res.json({
            accessToken: result.tokens.accessToken,
            refreshToken: result.tokens.refreshToken,
            user: result.user,
        });
    }
    catch (err) {
        console.error('Auto-login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
export default router;
