import jwt from 'jsonwebtoken';
const JWT_SECRET = 'serafa-jwt-secret-2026';
const JWT_REFRESH_SECRET = 'serafa-refresh-secret-2026';
export function verifyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid authorization header' });
        return;
    }
    const token = authHeader.substring(7);
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!roles.includes(req.user.role)) {
            res.status(403).json({ error: 'Insufficient permissions' });
            return;
        }
        next();
    };
}
export const JWT = {
    SECRET: JWT_SECRET,
    REFRESH_SECRET: JWT_REFRESH_SECRET,
};
export default verifyAuth;
