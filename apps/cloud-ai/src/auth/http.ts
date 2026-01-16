/**
 * HTTP Authentication Helpers
 * 
 * Provides secure authentication for HTTP routes.
 * SECURITY: Does NOT accept tokens from query parameters to prevent logging/exposure.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyAccessToken, AuthResult, AuthErrorCode, extractBearerToken, checkRateLimit } from './index';

/**
 * Standard CORS headers for auth responses
 */
export const AUTH_CORS_HEADERS = {
  // SECURITY: Restrict to allowed origins in production. 
  // For now, we use * but developers should configure this for their environment.
  // Ideally: 'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};

/**
 * Send a JSON response with proper headers
 */
export function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...AUTH_CORS_HEADERS,
  });
  res.end(body);
}

/**
 * Send an auth error response with proper error code
 */
export function sendAuthError(res: ServerResponse, error: AuthErrorCode, message?: string): void {
  const statusCode = error === AuthErrorCode.RATE_LIMITED ? 429 : 401;
  sendJson(res, statusCode, {
    ok: false,
    error,
    message: message || getDefaultErrorMessage(error),
  });
}

function getDefaultErrorMessage(error: AuthErrorCode): string {
  switch (error) {
    case AuthErrorCode.MISSING_TOKEN:
      return 'Authorization header required';
    case AuthErrorCode.INVALID_TOKEN:
      return 'Invalid access token';
    case AuthErrorCode.EXPIRED_TOKEN:
      return 'Access token expired. Please sign in again.';
    case AuthErrorCode.RATE_LIMITED:
      return 'Too many requests. Please try again later.';
    case AuthErrorCode.SERVER_ERROR:
      return 'Authentication service error';
    default:
      return 'Unauthorized';
  }
}

/**
 * Authenticate an HTTP request from headers only
 * SECURITY: Does NOT accept tokens from query parameters
 * 
 * @param req - The incoming HTTP request
 * @param options - Optional configuration
 * @returns AuthResult with user info or error
 */
export async function authenticateHttp(
  req: IncomingMessage,
  options: {
    rateLimit?: boolean;
    rateLimitKey?: string;
  } = {}
): Promise<AuthResult> {
  // Extract token from Authorization header ONLY
  const authHeader = req.headers['authorization'];
  const token = extractBearerToken(authHeader as string);

  if (!token) {
    return {
      success: false,
      error: AuthErrorCode.MISSING_TOKEN,
      message: 'Authorization header required. Use: Authorization: Bearer <token>',
    };
  }

  // Optional rate limiting
  if (options.rateLimit !== false) {
    const rateLimitKey = options.rateLimitKey || token.slice(0, 20);
    const rateCheck = checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      return {
        success: false,
        error: AuthErrorCode.RATE_LIMITED,
        message: `Rate limit exceeded. Try again in ${Math.ceil((rateCheck.resetAt - Date.now()) / 1000)} seconds.`,
      };
    }
  }

  return verifyAccessToken(token);
}

/**
 * Middleware-style auth check that handles error responses automatically
 * Returns the auth result if successful, or null if an error response was sent
 * 
 * Usage:
 * ```
 * const auth = await requireAuth(req, res);
 * if (!auth) return true; // Response already sent
 * // Use auth.userId, auth.email, etc.
 * ```
 */
export async function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
  options: {
    rateLimit?: boolean;
  } = {}
): Promise<AuthResult | null> {
  const auth = await authenticateHttp(req, options);

  if (!auth.success) {
    sendAuthError(res, auth.error!, auth.message);
    return null;
  }

  return auth;
}

/**
 * Extract user ID from a successful auth result
 * Throws if auth is not valid (use requireAuth first)
 */
export function getUserId(auth: AuthResult): string {
  if (!auth.success || !auth.userId) {
    throw new Error('Invalid auth result');
  }
  return auth.userId;
}

/**
 * Legacy helper: Accept token from query param for backward compatibility
 * DEPRECATED: Use requireAuth instead. This exists only for migration period.
 * 
 * @deprecated Will be removed in future version
 */
export async function authenticateHttpLegacy(
  req: IncomingMessage,
  parsedUrl: URL
): Promise<AuthResult> {
  // First try header (preferred)
  const authHeader = req.headers['authorization'];
  let token = extractBearerToken(authHeader as string);

  // Fall back to query param (deprecated, log warning)
  if (!token) {
    const queryToken = parsedUrl.searchParams.get('token');
    if (queryToken) {
      console.warn('[auth] DEPRECATED: Token passed in query parameter. Use Authorization header instead.');
      token = queryToken;
    }
  }

  if (!token) {
    return {
      success: false,
      error: AuthErrorCode.MISSING_TOKEN,
      message: 'Authorization header required',
    };
  }

  return verifyAccessToken(token);
}
