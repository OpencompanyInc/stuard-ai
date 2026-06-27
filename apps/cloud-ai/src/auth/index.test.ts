import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  AuthErrorCode,
  extractBearerToken,
  parseTokenInfo,
  isTokenExpiringSoon,
  generateSignedState,
  verifySignedState,
  generateSecureNonce,
  hmacSha256,
  checkRateLimit,
  authenticateRequest,
} from './index';

// Mock Supabase to prevent actual API calls
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
    },
  })),
}));

describe('auth module', () => {
  describe('extractBearerToken', () => {
    it('should extract token from valid Bearer header', () => {
      expect(extractBearerToken('Bearer abc123')).toBe('abc123');
      expect(extractBearerToken('bearer abc123')).toBe('abc123');
      expect(extractBearerToken('BEARER abc123')).toBe('abc123');
    });

    it('should handle extra whitespace', () => {
      expect(extractBearerToken('  Bearer   token123  ')).toBe('token123');
    });

    it('should return null for invalid headers', () => {
      expect(extractBearerToken('')).toBeNull();
      expect(extractBearerToken('Basic abc123')).toBeNull();
      expect(extractBearerToken('abc123')).toBeNull();
      expect(extractBearerToken(undefined)).toBeNull();
    });

    it('should return null for Bearer without token', () => {
      expect(extractBearerToken('Bearer ')).toBeNull();
      expect(extractBearerToken('Bearer')).toBeNull();
    });
  });

  describe('parseTokenInfo', () => {
    // Create a valid JWT-like token for testing
    const createMockJwt = (payload: object): string => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64');
      const signature = 'mocksignature';
      return `${header}.${body}.${signature}`;
    };

    it('should parse valid JWT token', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 3600; // 1 hour from now
      const token = createMockJwt({
        sub: 'user-123',
        email: 'test@example.com',
        exp,
        iat: now,
      });

      const info = parseTokenInfo(token);
      expect(info).not.toBeNull();
      expect(info?.userId).toBe('user-123');
      expect(info?.email).toBe('test@example.com');
      expect(info?.isExpired).toBe(false);
      expect(info?.expiresInSeconds).toBeGreaterThan(3500);
    });

    it('should detect expired token', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now - 3600; // 1 hour ago
      const token = createMockJwt({
        sub: 'user-123',
        exp,
        iat: now - 7200,
      });

      const info = parseTokenInfo(token);
      expect(info?.isExpired).toBe(true);
      expect(info?.expiresInSeconds).toBe(0);
    });

    it('should return null for invalid tokens', () => {
      expect(parseTokenInfo('')).toBeNull();
      expect(parseTokenInfo('invalid')).toBeNull();
      expect(parseTokenInfo('a.b')).toBeNull();
      expect(parseTokenInfo('not.a.valid.jwt')).toBeNull();
    });

    it('should handle missing fields gracefully', () => {
      const token = createMockJwt({});
      const info = parseTokenInfo(token);
      expect(info).not.toBeNull();
      expect(info?.userId).toBe('');
    });
  });

  describe('isTokenExpiringSoon', () => {
    const createMockJwt = (exp: number): string => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64');
      const body = Buffer.from(JSON.stringify({ sub: 'user', exp })).toString('base64');
      return `${header}.${body}.sig`;
    };

    it('should return true for token expiring within threshold', () => {
      const now = Math.floor(Date.now() / 1000);
      const token = createMockJwt(now + 60); // Expires in 1 minute
      expect(isTokenExpiringSoon(token, 300)).toBe(true); // 5 min threshold
    });

    it('should return false for token not expiring soon', () => {
      const now = Math.floor(Date.now() / 1000);
      const token = createMockJwt(now + 3600); // Expires in 1 hour
      expect(isTokenExpiringSoon(token, 300)).toBe(false);
    });

    it('should return true for already expired token', () => {
      const now = Math.floor(Date.now() / 1000);
      const token = createMockJwt(now - 100);
      expect(isTokenExpiringSoon(token)).toBe(true);
    });

    it('should return true for invalid token', () => {
      expect(isTokenExpiringSoon('invalid')).toBe(true);
    });
  });

  describe('generateSignedState and verifySignedState', () => {
    it('should generate and verify valid state', () => {
      const state = generateSignedState({
        provider: 'google',
        userId: 'user-123',
      });

      expect(state).toContain('.');
      const parts = state.split('.');
      expect(parts).toHaveLength(2);

      const verified = verifySignedState(state);
      expect(verified).not.toBeNull();
      expect(verified?.provider).toBe('google');
      expect(verified?.userId).toBe('user-123');
    });

    it('should include nonce in state', () => {
      const state = generateSignedState({
        provider: 'github',
        nonce: 'custom-nonce-123',
      });

      const verified = verifySignedState(state);
      expect(verified?.nonce).toBe('custom-nonce-123');
    });

    it('should reject tampered state', () => {
      const state = generateSignedState({ provider: 'google' });
      const [payload] = state.split('.');
      const tamperedState = `${payload}.invalidsignature`;

      expect(verifySignedState(tamperedState)).toBeNull();
    });

    it('should reject expired state', async () => {
      const state = generateSignedState({ provider: 'google' });
      // Wait a tiny bit then use very short max age to simulate expiry
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(verifySignedState(state, 1)).toBeNull(); // 1ms max age
    });

    it('should return null for invalid input', () => {
      expect(verifySignedState('')).toBeNull();
      expect(verifySignedState('invalid')).toBeNull();
      expect(verifySignedState('no.signature.here')).toBeNull();
    });
  });

  describe('generateSecureNonce', () => {
    it('should generate nonce of specified length', () => {
      const nonce = generateSecureNonce(16);
      expect(nonce.length).toBe(16);
    });

    it('should generate unique nonces', () => {
      const nonce1 = generateSecureNonce();
      const nonce2 = generateSecureNonce();
      expect(nonce1).not.toBe(nonce2);
    });

    it('should use default length of 32', () => {
      const nonce = generateSecureNonce();
      expect(nonce.length).toBe(32);
    });
  });

  describe('hmacSha256', () => {
    it('should produce consistent hash for same input', () => {
      const hash1 = hmacSha256('test-data', 'secret');
      const hash2 = hmacSha256('test-data', 'secret');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different data', () => {
      const hash1 = hmacSha256('data1', 'secret');
      const hash2 = hmacSha256('data2', 'secret');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash for different secrets', () => {
      const hash1 = hmacSha256('data', 'secret1');
      const hash2 = hmacSha256('data', 'secret2');
      expect(hash1).not.toBe(hash2);
    });

    it('should return hex string', () => {
      const hash = hmacSha256('test', 'secret');
      expect(hash).toMatch(/^[a-f0-9]+$/);
      expect(hash.length).toBe(64); // SHA256 = 256 bits = 64 hex chars
    });
  });

  describe('checkRateLimit', () => {
    beforeEach(() => {
      // Use unique identifiers for each test to avoid state pollution
    });

    it('should allow requests within limit', () => {
      const id = `test-${Date.now()}-${Math.random()}`;
      const result = checkRateLimit(id);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99); // 100 - 1
    });

    it('should track request count', () => {
      const id = `test-count-${Date.now()}`;
      checkRateLimit(id);
      checkRateLimit(id);
      const result = checkRateLimit(id);
      expect(result.remaining).toBe(97); // 100 - 3
    });

    it('should provide reset time', () => {
      const id = `test-reset-${Date.now()}`;
      const result = checkRateLimit(id);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    });
  });

  describe('authenticateRequest', () => {
    it('should return MISSING_TOKEN error when no authorization header', async () => {
      const result = await authenticateRequest({});
      expect(result.success).toBe(false);
      expect(result.error).toBe(AuthErrorCode.MISSING_TOKEN);
    });

    it('should return MISSING_TOKEN error for invalid header format', async () => {
      const result = await authenticateRequest({ authorization: 'Basic abc' });
      expect(result.success).toBe(false);
      expect(result.error).toBe(AuthErrorCode.MISSING_TOKEN);
    });
  });

  describe('AuthErrorCode enum', () => {
    it('should have all expected error codes', () => {
      expect(AuthErrorCode.INVALID_TOKEN).toBe('invalid_token');
      expect(AuthErrorCode.EXPIRED_TOKEN).toBe('expired_token');
      expect(AuthErrorCode.MISSING_TOKEN).toBe('missing_token');
      expect(AuthErrorCode.INSUFFICIENT_SCOPE).toBe('insufficient_scope');
      expect(AuthErrorCode.RATE_LIMITED).toBe('rate_limited');
      expect(AuthErrorCode.SERVER_ERROR).toBe('server_error');
      expect(AuthErrorCode.UNAUTHORIZED).toBe('unauthorized');
    });
  });
});
