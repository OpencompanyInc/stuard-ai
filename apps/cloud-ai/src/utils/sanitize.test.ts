import { describe, expect, it } from 'vitest';

import { redactSensitiveData, sanitizeToolEvent, sanitizeToolResult } from './sanitize';

describe('sanitize helpers', () => {
  it('preserves session identifiers while redacting real secrets', () => {
    const result = redactSensitiveData({
      sessionId: 'rec-123',
      session_id: 'rec-456',
      browserUseSessionId: 'browser-789',
      accessToken: 'secret-token',
      auth_session: { token: 'nested-secret' },
    });

    expect(result).toEqual({
      sessionId: 'rec-123',
      session_id: 'rec-456',
      browserUseSessionId: 'browser-789',
      accessToken: '[redacted]',
      auth_session: '[redacted]',
    });
  });

  it('keeps capture tool session ids intact in sanitized tool results', () => {
    const result = sanitizeToolResult({
      ok: true,
      sessionId: 'capture-abc',
      filePath: 'C:/Users/test/Documents/StuardAI/media/videos/video.mp4',
      mimeType: 'video/mp4',
    });

    expect(result).toMatchObject({
      ok: true,
      sessionId: 'capture-abc',
      filePath: 'C:/Users/test/Documents/StuardAI/media/videos/video.mp4',
      mimeType: 'video/mp4',
    });
  });

  it('keeps capture tool session ids intact in sanitized tool events', () => {
    const event = sanitizeToolEvent({
      tool: 'capture_media',
      args: { mode: 'until_stop', sessionId: 'capture-evt' },
      result: { ok: true, sessionId: 'capture-evt' },
    });

    expect(event).toMatchObject({
      tool: 'capture_media',
      args: { mode: 'until_stop', sessionId: 'capture-evt' },
      result: { ok: true, sessionId: 'capture-evt' },
    });
  });
});
