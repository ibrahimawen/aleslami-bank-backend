import { queryOne } from '../db/instance.js';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT } from '../middleware/auth.js';
export async function loginUser(username, password) {
    const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
        return null;
    }
    const passwordMatch = await bcryptjs.compare(password, user.password_hash);
    if (!passwordMatch) {
        return null;
    }
    // company_id is always taken from the database — each user is linked to their company
    const effectiveCompanyId = user.company_id || undefined;
    const tokens = generateTokens({
        id: user.id,
        username: user.username,
        role: user.role,
        companyId: effectiveCompanyId,
    });
    const authUser = {
        id: user.id,
        username: user.username,
        role: user.role,
        companyId: effectiveCompanyId,
    };
    return { tokens, user: authUser };
}
export function generateTokens(user) {
    const payload = {
        id: user.id,
        username: user.username,
        role: user.role,
        ...(user.companyId && { companyId: user.companyId }),
    };
    const accessToken = jwt.sign(payload, JWT.SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign(payload, JWT.REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken };
}
export function refreshAccessToken(refreshToken) {
    try {
        const decoded = jwt.verify(refreshToken, JWT.REFRESH_SECRET);
        const newAccessToken = jwt.sign({
            id: decoded.id,
            username: decoded.username,
            role: decoded.role,
            ...(decoded.companyId && { companyId: decoded.companyId }),
        }, JWT.SECRET, { expiresIn: '15m' });
        return newAccessToken;
    }
    catch (err) {
        return null;
    }
}
