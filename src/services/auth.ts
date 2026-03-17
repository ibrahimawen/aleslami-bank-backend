import { queryOne } from '../db/instance.js';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT, AuthUser } from '../middleware/auth.js';

interface User {
  id: number;
  username: string;
  password_hash: string;
  role: 'bank_admin' | 'company_user';
  company_id: string | null;
}

interface TokenPayload {
  id: number;
  username: string;
  role: 'bank_admin' | 'company_user';
  companyId?: string;
}

interface TokenResult {
  accessToken: string;
  refreshToken: string;
}

export async function loginUser(
  username: string,
  password: string
): Promise<{ tokens: TokenResult; user: AuthUser } | null> {
  const user = queryOne('SELECT * FROM users WHERE username = ?', [username]) as User | null;

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

  const authUser: AuthUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    companyId: effectiveCompanyId,
  };

  return { tokens, user: authUser };
}

export function generateTokens(user: TokenPayload): TokenResult {
  const payload: TokenPayload = {
    id: user.id,
    username: user.username,
    role: user.role,
    ...(user.companyId && { companyId: user.companyId }),
  };

  const accessToken = jwt.sign(payload, JWT.SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, JWT.REFRESH_SECRET, { expiresIn: '7d' });

  return { accessToken, refreshToken };
}

export function refreshAccessToken(refreshToken: string): string | null {
  try {
    const decoded = jwt.verify(refreshToken, JWT.REFRESH_SECRET) as TokenPayload;
    const newAccessToken = jwt.sign(
      {
        id: decoded.id,
        username: decoded.username,
        role: decoded.role,
        ...(decoded.companyId && { companyId: decoded.companyId }),
      },
      JWT.SECRET,
      { expiresIn: '15m' }
    );
    return newAccessToken;
  } catch (err) {
    return null;
  }
}
