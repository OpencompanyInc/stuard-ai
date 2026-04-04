import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getExternalAccountMock = vi.fn();
const upsertExternalAccountMock = vi.fn();
const listExternalAccountsMock = vi.fn();
const refreshGoogleTokenIfNeededMock = vi.fn();

vi.mock('../supabase', () => ({
  getExternalAccount: (...args: any[]) => getExternalAccountMock(...args),
  upsertExternalAccount: (...args: any[]) => upsertExternalAccountMock(...args),
  listExternalAccounts: (...args: any[]) => listExternalAccountsMock(...args),
}));

vi.mock('../routes/integrations/google-shared', () => ({
  refreshGoogleTokenIfNeeded: (...args: any[]) => refreshGoogleTokenIfNeededMock(...args),
}));

import { gmail_search_messages } from './google-tools';
import { clearActiveBridge, setActiveBridge } from './device/shared';

describe('google tool bridge fallback', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();

    getExternalAccountMock.mockResolvedValue({
      access_token: 'stored-access-token',
      refresh_token: null,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      profile_label: 'default',
      account_email: 'user@example.com',
      meta: {},
    });
    refreshGoogleTokenIfNeededMock.mockResolvedValue('fresh-access-token');
  });

  afterEach(() => {
    clearActiveBridge();
    global.fetch = originalFetch;
  });

  it('uses the active bridge fallback when delegated Gmail search loses ALS context', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({ messages: [] }),
    }) as any;

    const scope = setActiveBridge(null, { userId: 'user-123' });

    try {
      const result = await gmail_search_messages.execute?.({
        query: 'from:support@stuard.ai',
        maxResults: 5,
      }, {} as any);

      expect(result).toMatchObject({
        count: 0,
        items: [],
      });
      expect(getExternalAccountMock).toHaveBeenCalledWith('user-123', 'google', undefined);
      expect(refreshGoogleTokenIfNeededMock).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://gmail.googleapis.com/gmail/v1/users/me/messages?'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer fresh-access-token',
          }),
        }),
      );
    } finally {
      clearActiveBridge(scope);
    }
  });
});
