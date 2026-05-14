import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getExternalAccountMock = vi.fn();
const upsertExternalAccountMock = vi.fn();
const logUsageEventMock = vi.fn();
const checkAccessMock = vi.fn();
const getVMOAuthAccountMock = vi.fn();
const storeVMOAuthAccountMock = vi.fn();

vi.mock('../supabase', () => ({
  getExternalAccount: (...args: any[]) => getExternalAccountMock(...args),
  upsertExternalAccount: (...args: any[]) => upsertExternalAccountMock(...args),
  logUsageEvent: (...args: any[]) => logUsageEventMock(...args),
  checkAccess: (...args: any[]) => checkAccessMock(...args),
}));

vi.mock('./bridge', () => ({
  getBridgeSecrets: () => ({ userId: 'user-123' }),
}));

vi.mock('./device/shared', () => ({
  getResolvedBridgeSecrets: () => ({ userId: 'user-123' }),
}));

vi.mock('./vm-oauth', () => ({
  getVMOAuthAccount: (...args: any[]) => getVMOAuthAccountMock(...args),
  storeVMOAuthAccount: (...args: any[]) => storeVMOAuthAccountMock(...args),
}));

import { x_list_dms } from './x-tools';

function jsonResponse(body: any, init: Partial<Response> = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
  } as any;
}

describe('x_list_dms', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    getVMOAuthAccountMock.mockResolvedValue(null);
    getExternalAccountMock.mockResolvedValue({
      access_token: 'x-access-token',
      refresh_token: null,
      scopes: ['dm.read'],
      profile_label: 'default',
      account_email: '@self',
      meta: {},
    });
    checkAccessMock.mockResolvedValue({ allowed: true });
    logUsageEventMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns both sent and received DM events with sender details', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      data: [
        {
          id: 'evt-reply',
          event_type: 'MessageCreate',
          text: 'reply from the other person',
          sender_id: '222',
          dm_conversation_id: '111-222',
          created_at: '2026-05-14T10:02:00.000Z',
        },
        {
          id: 'evt-sent',
          event_type: 'MessageCreate',
          text: 'message I sent',
          sender_id: '111',
          dm_conversation_id: '111-222',
          created_at: '2026-05-14T10:00:00.000Z',
        },
      ],
      includes: {
        users: [
          { id: '111', username: 'self', name: 'Self' },
          { id: '222', username: 'friend', name: 'Friend' },
        ],
      },
      meta: { result_count: 2, next_token: 'NEXTTOKEN12345678' },
    })) as any;

    const result = await x_list_dms.execute?.({
      conversation_id: '111-222',
      max_results: 20,
    }, {} as any);

    expect(result).toMatchObject({
      count: 2,
      result_count: 2,
      next_token: 'NEXTTOKEN12345678',
      events: [
        {
          id: 'evt-reply',
          text: 'reply from the other person',
          sender_id: '222',
          sender: { id: '222', username: 'friend', name: 'Friend' },
          conversation_id: '111-222',
        },
        {
          id: 'evt-sent',
          text: 'message I sent',
          sender_id: '111',
          sender: { id: '111', username: 'self', name: 'Self' },
          conversation_id: '111-222',
        },
      ],
    });
    const [url, request] = (global.fetch as any).mock.calls[0];
    expect(url).toContain('/dm_conversations/111-222/dm_events?');
    expect(decodeURIComponent(url)).toContain('dm_event.fields=id,text,created_at,sender_id,event_type,dm_conversation_id');
    expect(decodeURIComponent(url)).toContain('event_types=MessageCreate');
    expect(decodeURIComponent(url)).toContain('expansions=sender_id');
    expect(request.headers.Authorization).toBe('Bearer x-access-token');
  });

  it('can resolve a participant username and pass pagination_token', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: '222', username: 'friend' } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: { result_count: 0 } })) as any;

    const result = await x_list_dms.execute?.({
      participant_username: '@friend',
      pagination_token: 'PAGE123456789012',
      max_results: 5,
    }, {} as any);

    expect(result).toMatchObject({ count: 0, events: [] });
    expect((global.fetch as any).mock.calls[0][0]).toContain('/users/by/username/friend');
    const dmsUrl = decodeURIComponent((global.fetch as any).mock.calls[1][0]);
    expect(dmsUrl).toContain('/dm_conversations/with/222/dm_events?');
    expect(dmsUrl).toContain('pagination_token=PAGE123456789012');
  });
});
