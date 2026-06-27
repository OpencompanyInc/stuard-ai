import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Google tokens are now device-held and fetched via the unified client
// accessors in ./vm-oauth (desktop bridge or VM) — never Supabase. Mock those
// accessors so this test exercises google-tools' wiring without the bridge.
const getClientOAuthAccountMock = vi.fn();
const listClientOAuthAccountsMock = vi.fn();
const storeClientOAuthAccountMock = vi.fn();

vi.mock('./vm-oauth', () => ({
  getClientOAuthAccount: (...args: any[]) => getClientOAuthAccountMock(...args),
  listClientOAuthAccounts: (...args: any[]) => listClientOAuthAccountsMock(...args),
  storeClientOAuthAccount: (...args: any[]) => storeClientOAuthAccountMock(...args),
  shouldUseVMOAuth: () => false,
}));

import { gmail_search_messages, calendar_create_event } from './google-tools';
import { clearActiveBridge, setActiveBridge } from './device/shared';

describe('google tools use device-held tokens (no Supabase)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    getClientOAuthAccountMock.mockResolvedValue({
      provider: 'google',
      access_token: 'device-access-token',
      refresh_token: null,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      profile_label: 'default',
      is_default: true,
      account_email: 'user@example.com',
      meta: { source: 'vm' },
    });
  });

  afterEach(() => {
    clearActiveBridge();
    global.fetch = originalFetch;
  });

  it('fetches the token from the client store and calls Gmail with it', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({ messages: [] }),
    }) as any;

    // userId comes from the module-level bridge secrets fallback (ALS broken).
    const scope = setActiveBridge(null, { userId: 'user-123' });

    try {
      const result = await gmail_search_messages.execute?.({
        query: 'from:support@stuard.ai',
        maxResults: 5,
      }, {} as any);

      expect(result).toMatchObject({ count: 0, items: [] });
      expect(getClientOAuthAccountMock).toHaveBeenCalledWith('google', undefined);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://gmail.googleapis.com/gmail/v1/users/me/messages?'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer device-access-token',
          }),
        }),
      );
    } finally {
      clearActiveBridge(scope);
    }
  });

  it('attaches a Google Meet conference and returns the meet link', async () => {
    getClientOAuthAccountMock.mockResolvedValue({
      provider: 'google',
      access_token: 'device-access-token',
      refresh_token: null,
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
      profile_label: 'default',
      is_default: true,
      account_email: 'user@example.com',
      meta: { source: 'vm' },
    });

    const meetLink = 'https://meet.google.com/abc-defg-hij';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({
        id: 'evt1',
        hangoutLink: meetLink,
        conferenceData: { entryPoints: [{ entryPointType: 'video', uri: meetLink }] },
      }),
    }) as any;

    const scope = setActiveBridge(null, { userId: 'user-123' });
    try {
      const result: any = await calendar_create_event.execute?.({
        summary: 'Sync call',
        start: '2026-07-01T15:00:00Z',
        end: '2026-07-01T15:30:00Z',
        addGoogleMeet: true,
        sendUpdates: 'all',
        attendees: [{ email: 'guest@example.com' }],
      }, {} as any);

      expect(result.meetLink).toBe(meetLink);

      const calls = (global.fetch as any).mock.calls;
      const createCall = calls.find((c: any) => /\/calendar\/v3\/calendars\/.+\/events/.test(String(c[0])) && c[1]?.method === 'POST');
      expect(createCall).toBeTruthy();
      expect(String(createCall[0])).toContain('conferenceDataVersion=1');
      expect(String(createCall[0])).toContain('sendUpdates=all');
      const sentBody = JSON.parse(createCall[1].body);
      expect(sentBody.conferenceData?.createRequest?.conferenceSolutionKey?.type).toBe('hangoutsMeet');
    } finally {
      clearActiveBridge(scope);
    }
  });
});
