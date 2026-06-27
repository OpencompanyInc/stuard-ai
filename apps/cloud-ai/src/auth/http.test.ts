import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

// Mock the auth index module
vi.mock('./index', () => ({
  verifyAccessToken: vi.fn(),
  extractBearerToken: vi.fn((header: string | undefined) => {
    if (!header) return null;
    const trimmed = header.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      return trimmed.slice(7).trim() || null;
    }
    return null;
  }),
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 99, resetAt: Date.now() + 60000 })),
  AuthErrorCode: {
    INVALID_TOKEN: 'invalid_token',
    EXPIRED_TOKEN: 'expired_token',
    MISSING_TOKEN: 'missing_token',
    RATE_LIMITED: 'rate_limited',
    SERVER_ERROR: 'server_error',
    UNAUTHORIZED: 'unauthorized',
  },
  AuthResult: {},
}));

import {
  AUTH_CORS_HEADERS,
  sendJson,
  sendAuthError,
  authenticateHttp,
  requireAuth,
  getUserId,
} from './http';
import { AuthErrorCode, verifyAccessToken, checkRateLimit } from './index';

// Helper to create mock request
function createMockRequest(headers: Record<string, string> = {}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.headers = headers;
  return req;
}

// Helper to create mock response
function createMockResponse(): ServerResponse & {
  _statusCode: number;
  _headers: Record<string, string | number>;
  _body: string;
} {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  const res = new ServerResponse(req) as ServerResponse & {
    _statusCode: number;
    _headers: Record<string, string | number>;
    _body: string;
  };

  res._statusCode = 200;
  res._headers = {};
  res._body = '';

  (res as any).writeHead = vi.fn(((statusCode: number, headers?: Record<string, string | number>) => {
    res._statusCode = statusCode;
    if (headers) {
      res._headers = { ...res._headers, ...headers };
    }
    return res;
  }) as any);

  (res as any).end = vi.fn(((body?: string) => {
    if (body) res._body = body;
    return res;
  }) as any);

  return res;
}

describe('auth/http module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AUTH_CORS_HEADERS', () => {
    it('should have correct CORS headers', () => {
      expect(AUTH_CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*');
      expect(AUTH_CORS_HEADERS['Access-Control-Allow-Methods']).toContain('GET');
      expect(AUTH_CORS_HEADERS['Access-Control-Allow-Methods']).toContain('POST');
      expect(AUTH_CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Authorization');
      expect(AUTH_CORS_HEADERS['Cache-Control']).toBe('no-store');
    });
  });

  describe('sendJson', () => {
    it('should send JSON response with correct headers', () => {
      const res = createMockResponse();
      const data = { message: 'Hello', value: 42 };

      sendJson(res, 200, data);

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Content-Type': 'application/json',
      }));
      expect(res.end).toHaveBeenCalledWith(JSON.stringify(data));
    });

    it('should set correct status codes', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();

      sendJson(res1, 201, { created: true });
      sendJson(res2, 404, { error: 'Not found' });

      expect(res1._statusCode).toBe(201);
      expect(res2._statusCode).toBe(404);
    });

    it('should include CORS headers', () => {
      const res = createMockResponse();
      sendJson(res, 200, {});

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Access-Control-Allow-Origin': '*',
      }));
    });
  });

  describe('sendAuthError', () => {
    it('should send 401 for most auth errors', () => {
      const res = createMockResponse();
      sendAuthError(res, AuthErrorCode.INVALID_TOKEN);

      expect(res._statusCode).toBe(401);
      const body = JSON.parse(res._body);
      expect(body.ok).toBe(false);
      expect(body.error).toBe(AuthErrorCode.INVALID_TOKEN);
    });

    it('should send 429 for rate limit errors', () => {
      const res = createMockResponse();
      sendAuthError(res, AuthErrorCode.RATE_LIMITED);

      expect(res._statusCode).toBe(429);
    });

    it('should use custom message when provided', () => {
      const res = createMockResponse();
      sendAuthError(res, AuthErrorCode.EXPIRED_TOKEN, 'Custom expiry message');

      const body = JSON.parse(res._body);
      expect(body.message).toBe('Custom expiry message');
    });

    it('should use default messages for each error type', () => {
      const testCases = [
        { error: AuthErrorCode.MISSING_TOKEN, expectedContains: 'required' },
        { error: AuthErrorCode.INVALID_TOKEN, expectedContains: 'Invalid' },
        { error: AuthErrorCode.EXPIRED_TOKEN, expectedContains: 'expired' },
        { error: AuthErrorCode.RATE_LIMITED, expectedContains: 'Too many' },
        { error: AuthErrorCode.SERVER_ERROR, expectedContains: 'error' },
      ];

      for (const { error, expectedContains } of testCases) {
        const res = createMockResponse();
        sendAuthError(res, error);
        const body = JSON.parse(res._body);
        expect(body.message.toLowerCase()).toContain(expectedContains.toLowerCase());
      }
    });
  });

  describe('authenticateHttp', () => {
    it('should return MISSING_TOKEN when no authorization header', async () => {
      const req = createMockRequest({});

      const result = await authenticateHttp(req);

      expect(result.success).toBe(false);
      expect(result.error).toBe(AuthErrorCode.MISSING_TOKEN);
    });

    it('should return MISSING_TOKEN for non-Bearer auth', async () => {
      const req = createMockRequest({ authorization: 'Basic abc123' });

      const result = await authenticateHttp(req);

      expect(result.success).toBe(false);
      expect(result.error).toBe(AuthErrorCode.MISSING_TOKEN);
    });

    it('should check rate limit when enabled', async () => {
      const req = createMockRequest({ authorization: 'Bearer validtoken' });
      vi.mocked(verifyAccessToken).mockResolvedValue({
        success: true,
        userId: 'user-123',
      });

      await authenticateHttp(req, { rateLimit: true });

      expect(checkRateLimit).toHaveBeenCalled();
    });

    it('should return RATE_LIMITED when rate limit exceeded', async () => {
      const req = createMockRequest({ authorization: 'Bearer validtoken' });
      vi.mocked(checkRateLimit).mockReturnValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30000,
      });

      const result = await authenticateHttp(req, { rateLimit: true });

      expect(result.success).toBe(false);
      expect(result.error).toBe(AuthErrorCode.RATE_LIMITED);
    });

    it('should call verifyAccessToken with extracted token', async () => {
      const req = createMockRequest({ authorization: 'Bearer mytoken123' });
      vi.mocked(verifyAccessToken).mockResolvedValue({
        success: true,
        userId: 'user-456',
      });
      vi.mocked(checkRateLimit).mockReturnValue({
        allowed: true,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await authenticateHttp(req);

      expect(verifyAccessToken).toHaveBeenCalledWith('mytoken123');
    });
  });

  describe('requireAuth', () => {
    it('should return null and send error when auth fails', async () => {
      const req = createMockRequest({});
      const res = createMockResponse();

      const result = await requireAuth(req, res);

      expect(result).toBeNull();
      expect(res._statusCode).toBe(401);
    });

    it('should return auth result when successful', async () => {
      const req = createMockRequest({ authorization: 'Bearer validtoken' });
      const res = createMockResponse();
      vi.mocked(verifyAccessToken).mockResolvedValue({
        success: true,
        userId: 'user-789',
        email: 'test@example.com',
      });
      vi.mocked(checkRateLimit).mockReturnValue({
        allowed: true,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      const result = await requireAuth(req, res);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.userId).toBe('user-789');
    });
  });

  describe('getUserId', () => {
    it('should return userId from valid auth result', () => {
      const auth = { success: true, userId: 'user-abc' };
      expect(getUserId(auth as any)).toBe('user-abc');
    });

    it('should throw for invalid auth result', () => {
      expect(() => getUserId({ success: false } as any)).toThrow('Invalid auth result');
      expect(() => getUserId({ success: true } as any)).toThrow('Invalid auth result');
    });
  });
});
