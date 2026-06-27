/**
 * Authentication Module for Cloud-AI
 * 
 * Provides secure token verification, session validation, and auth utilities.
 * Production-ready with proper error handling and security measures.
 */

import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ENVIRONMENT, IS_DEVELOPMENT } from '../utils/config';

// Environment configuration
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEFAULT_AUTH_SECRET = 'stuard-auth-secret-change-in-production';
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.INTEGRATION_STATE_SECRET || DEFAULT_AUTH_SECRET;

// Supabase clients
let supabaseAnon: SupabaseClient | null = null;
let supabaseService: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
  supabaseAnon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { 
    auth: { persistSession: false } 
  });
}

if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  supabaseService = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { 
    auth: { persistSession: false } 
  });
}

/**
 * Fail-fast guard for deployed (non-development) environments.
 *
 * AUTH_SECRET signs OAuth `state` (CSRF defense for the connect flow) and other
 * HMACs. If it's unset or still the shipped default, those signatures are
 * forgeable. Call this once at server boot — throwing here keeps a misconfigured
 * deploy from ever serving traffic. No-op in development, where the default is
 * acceptable.
 *
 * Note: this does NOT affect chat session auth, which is verified against
 * Supabase JWKS independently of AUTH_SECRET.
 */
export function assertAuthSecretConfigured(): void {
  if (IS_DEVELOPMENT) return;

  if (AUTH_SECRET === DEFAULT_AUTH_SECRET) {
    throw new Error(
      `[auth] Refusing to start in '${ENVIRONMENT}': AUTH_SECRET (or ` +
        'INTEGRATION_STATE_SECRET) is unset or uses the built-in default, so OAuth ' +
        '`state` signatures would be forgeable. Set AUTH_SECRET to a high-entropy ' +
        'random value, e.g. `openssl rand -hex 32`.',
    );
  }

  if (AUTH_SECRET.trim().length < 32) {
    throw new Error(
      `[auth] Refusing to start in '${ENVIRONMENT}': AUTH_SECRET is too short ` +
        `(${AUTH_SECRET.trim().length} chars). Use at least 32 random characters.`,
    );
  }
}

// Auth error codes for proper client handling
export enum AuthErrorCode {
  INVALID_TOKEN = 'invalid_token',
  EXPIRED_TOKEN = 'expired_token',
  MISSING_TOKEN = 'missing_token',
  INSUFFICIENT_SCOPE = 'insufficient_scope',
  RATE_LIMITED = 'rate_limited',
  SERVER_ERROR = 'server_error',
  UNAUTHORIZED = 'unauthorized',
}

export interface AuthResult {
  success: boolean;
  userId?: string;
  email?: string;
  user?: User;
  error?: AuthErrorCode;
  message?: string;
  expiresAt?: number; // Unix timestamp when token expires
}

export interface TokenInfo {
  userId: string;
  email?: string;
  expiresAt: number;
  issuedAt: number;
  isExpired: boolean;
  expiresInSeconds: number;
}

type VerifiedClaims = {
  sub?: string;
  email?: string;
  exp?: number;
  [key: string]: any;
};

function mapAuthError(error: any): AuthResult {
  const errorMsg = String(error?.message || '').toLowerCase();

  if (errorMsg.includes('expired') || errorMsg.includes('jwt expired')) {
    return {
      success: false,
      error: AuthErrorCode.EXPIRED_TOKEN,
      message: 'Access token has expired. Please sign in again.',
    };
  }

  if (errorMsg.includes('invalid') || errorMsg.includes('malformed')) {
    return {
      success: false,
      error: AuthErrorCode.INVALID_TOKEN,
      message: 'Invalid access token',
    };
  }

  return {
    success: false,
    error: AuthErrorCode.UNAUTHORIZED,
    message: error?.message || 'Authentication failed',
  };
}

/**
 * Verify a Supabase access token and return detailed auth result
 * Distinguishes between invalid tokens and expired tokens for proper client handling
 */
export async function verifyAccessToken(token: string): Promise<AuthResult> {
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return { 
      success: false, 
      error: AuthErrorCode.MISSING_TOKEN, 
      message: 'No access token provided' 
    };
  }

  if (!supabaseAnon) {
    console.error('[auth] Supabase client not initialized');
    return { 
      success: false, 
      error: AuthErrorCode.SERVER_ERROR, 
      message: 'Auth service unavailable' 
    };
  }

  try {
    // getClaims verifies the JWT via JWKS when possible, avoiding the per-message
    // Auth service / user DB lookup that getUser performs.
    const { data, error } = await supabaseAnon.auth.getClaims(token);

    if (error) return mapAuthError(error);

    const claims = data?.claims as VerifiedClaims | undefined;
    if (!claims?.sub) {
      return { 
        success: false, 
        error: AuthErrorCode.INVALID_TOKEN, 
        message: 'No user found for this token'
      };
    }

    return {
      success: true,
      userId: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      expiresAt: typeof claims.exp === 'number' ? claims.exp * 1000 : undefined,
    };
  } catch (err) {
    console.error('[auth] Token verification error:', err);
    return { 
      success: false, 
      error: AuthErrorCode.SERVER_ERROR, 
      message: 'Authentication service error' 
    };
  }
}

/**
 * Legacy verifyToken function for backward compatibility
 * Returns simple format: { userId, email } or null
 */
export async function verifyToken(token: string): Promise<{ userId: string; email?: string } | null> {
  const result = await verifyAccessToken(token);
  if (!result.success || !result.userId) return null;
  return { userId: result.userId, email: result.email };
}

/**
 * Extract token info without full verification (for expiry checks)
 * WARNING: This does NOT verify the token signature - use only for pre-flight checks
 */
export function parseTokenInfo(token: string): TokenInfo | null {
  if (!token || typeof token !== 'string') return null;
  
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    const now = Math.floor(Date.now() / 1000);
    const exp = payload.exp || 0;
    const iat = payload.iat || 0;
    
    return {
      userId: payload.sub || '',
      email: payload.email,
      expiresAt: exp * 1000,
      issuedAt: iat * 1000,
      isExpired: exp > 0 && now >= exp,
      expiresInSeconds: exp > 0 ? Math.max(0, exp - now) : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a token will expire within the given threshold
 */
export function isTokenExpiringSoon(token: string, thresholdSeconds: number = 300): boolean {
  const info = parseTokenInfo(token);
  if (!info) return true; // Assume expired if can't parse
  return info.expiresInSeconds <= thresholdSeconds;
}

/**
 * Generate a secure signed state for OAuth flows
 * Prevents CSRF attacks by including user info and signature
 */
export function generateSignedState(params: { 
  provider: string; 
  userId?: string; 
  nonce?: string;
  extra?: Record<string, string>;
}): string {
  const nonce = params.nonce || randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const data = {
    p: params.provider,
    u: params.userId || '',
    n: nonce,
    t: timestamp,
    ...params.extra,
  };
  
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('hex');
  
  return `${payload}.${signature}`;
}

/**
 * Verify a signed state from OAuth callback
 * Returns the original data if valid, null if invalid/expired
 */
export function verifySignedState(state: string, maxAgeMs: number = 600000): { 
  provider: string; 
  userId: string; 
  nonce: string; 
  timestamp: number;
  extra?: Record<string, string>;
} | null {
  if (!state || typeof state !== 'string') return null;
  
  try {
    const [payload, signature] = state.split('.');
    if (!payload || !signature) return null;
    
    // Verify signature using timing-safe comparison
    const expectedSig = createHmac('sha256', AUTH_SECRET)
      .update(payload)
      .digest('hex');
    
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSig, 'hex');
    
    if (sigBuffer.length !== expectedBuffer.length) return null;
    if (!timingSafeEqual(sigBuffer, expectedBuffer)) return null;
    
    // Parse payload
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    
    // Check timestamp
    const age = Date.now() - (data.t || 0);
    if (age < 0 || age > maxAgeMs) return null;
    
    return {
      provider: data.p || '',
      userId: data.u || '',
      nonce: data.n || '',
      timestamp: data.t || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Extract token from Authorization header
 * Supports both "Bearer <token>" format
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || typeof authHeader !== 'string') return null;
  
  const trimmed = authHeader.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim() || null;
  }
  
  return null;
}

/**
 * Middleware helper to extract and verify auth from request headers
 * Does NOT accept tokens from query params (security best practice)
 */
export async function authenticateRequest(headers: { authorization?: string }): Promise<AuthResult> {
  const token = extractBearerToken(headers.authorization);
  if (!token) {
    return { 
      success: false, 
      error: AuthErrorCode.MISSING_TOKEN, 
      message: 'Authorization header required' 
    };
  }
  
  return verifyAccessToken(token);
}

/**
 * Generate a secure nonce for PKCE or state parameters
 */
export function generateSecureNonce(length: number = 32): string {
  return randomBytes(length).toString('base64url').slice(0, length);
}

/**
 * Hash a value using HMAC-SHA256 (for state verification)
 */
export function hmacSha256(data: string, secret: string = AUTH_SECRET): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

// Rate limiting (simple in-memory implementation)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // per window

export function checkRateLimit(identifier: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);
  
  if (!entry || now >= entry.resetAt) {
    // New window
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitMap.set(identifier, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt };
  }
  
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - entry.count, resetAt: entry.resetAt };
}

// Cleanup old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}, 60000);

// Export types and utilities
export { supabaseAnon, supabaseService };
