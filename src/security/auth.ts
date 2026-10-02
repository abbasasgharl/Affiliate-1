import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types.ts';

const JWT_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'affiliateos_super_secure_jwt_secret_2026_prod';
const TOKEN_EXPIRY = '7d';

export interface AuthUserPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

/**
 * Hash a plain text password with bcrypt (salt rounds = 10)
 */
export async function hashPassword(plainText: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainText, salt);
}

/**
 * Verify a plain text password against a bcrypt hash
 */
export async function comparePassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}

/**
 * Generate a signed JWT session token
 */
export function generateAuthToken(payload: AuthUserPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * Verify and decode a JWT session token
 */
export function verifyAuthToken(token: string): AuthUserPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUserPayload;
  } catch {
    return null;
  }
}

/**
 * Express middleware: requires an authenticated user with a valid Bearer token or cookie.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers.cookie) {
    // Check for auth_token cookie
    const match = req.headers.cookie.match(/auth_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required. Please sign in with valid admin credentials.' }
    });
    return;
  }

  const user = verifyAuthToken(token);
  if (!user) {
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Session expired or invalid token. Please log in again.' }
    });
    return;
  }

  req.user = user;
  next();
}

/**
 * Express middleware: enforces specific role(s) (e.g. 'super_admin' or 'editor').
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' }
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Action requires role: ${allowedRoles.join(' or ')}. Current role: ${req.user.role}.`
        }
      });
      return;
    }

    next();
  };
}

/**
 * Optional authentication middleware: sets req.user if valid token exists, but doesn't block.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/auth_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (token) {
    const user = verifyAuthToken(token);
    if (user) req.user = user;
  }

  next();
}
