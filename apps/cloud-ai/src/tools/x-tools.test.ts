import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logUsageEventMock = vi.fn();
const checkAccessMock = vi.fn();
const getClientOAuthAccountMock = vi.fn();
const storeClientOAuthAccountMock = vi.fn();

vi.mock('../supabase', () => ({
  logUsageEvent: (...args: any[]) => logUsageEventMock(...args),
  checkAccess: (...args: any[]) => checkAccessMock(...args),
}));

vi.mock('./bridge', () => ({
  getBridgeSecrets: () => ({ userId: 'user-123' }),
}));

vi.mock('./device/shared', () => ({
  getResolvedBridgeSecrets: () => ({ userId: 'user-123' }),
}));

// Tokens are device-held: tools read via getClientOAuthAccount (VM or desktop)
// and persist refreshes via storeClientOAuthAccount — never Supabase.
vi.mock('./vm-oauth', () => ({
  getClientOAuthAccount: (...args: any[]) => getClientOAuthAccountMock(...args),
  storeClientOAuthAccount: (...args: any[]) => storeClientOAuthAccountMock(...args),
}));

import { x_list_dms, x_reply_to_comment } from './x-tools';

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
    getClientOAuthAccountMock.mockResolvedValue({
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

describe('x_reply_to_comment', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    getClientOAuthAccountMock.mockResolvedValue({
      access_token: 'x-access-token',
      refresh_token: null,
      scopes: ['tweet.read', 'tweet.write', 'users.read'],
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

  it('creates replies with the documented X API v2 payload', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      data: { id: 'reply-123', text: 'Thanks!' },
    })) as any;

    const result = await x_reply_to_comment.execute?.({
      comment_id: 'tweet-456',
      text: 'Thanks!',
    }, {} as any);

    expect(result).toMatchObject({
      id: 'reply-123',
      text: 'Thanks!',
      in_reply_to_tweet_id: 'tweet-456',
      url: 'https://x.com/i/status/reply-123',
    });
    const [url, request] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.x.com/2/tweets');
    expect(request.method).toBe('POST');
    expect(request.headers.Authorization).toBe('Bearer x-access-token');
    expect(JSON.parse(request.body)).toEqual({
      text: 'Thanks!',
      reply: {
        in_reply_to_tweet_id: 'tweet-456',
        auto_populate_reply_metadata: true,
      },
    });
  });

  it('accepts tweet_id as an alias for comment_id', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      data: { id: 'reply-789', text: 'Alias works' },
    })) as any;

    await x_reply_to_comment.execute?.({
      tweet_id: 'tweet-999',
      text: 'Alias works',
    }, {} as any);

    const request = (global.fetch as any).mock.calls[0][1];
    expect(JSON.parse(request.body).reply.in_reply_to_tweet_id).toBe('tweet-999');
  });

  it('fails before posting when the stored token is missing tweet.write', async () => {
    getClientOAuthAccountMock.mockResolvedValue({
      access_token: 'x-access-token',
      refresh_token: null,
      scopes: ['tweet.read', 'like.write', 'users.read'],
      profile_label: 'default',
      account_email: '@self',
      meta: {},
    });
    global.fetch = vi.fn() as any;

    await expect(x_reply_to_comment.execute?.({
      comment_id: 'tweet-456',
      text: 'Thanks!',
    }, {} as any)).rejects.toThrow('x_missing_scope');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('explains X self-serve API reply restrictions separately from web UI replies', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      detail: 'The original Tweet author restricted who can reply to this Tweet.',
    }, {
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    })) as any;

    await expect(x_reply_to_comment.execute?.({
      comment_id: 'tweet-456',
      text: 'Thanks!',
    }, {} as any)).rejects.toThrow('web UI can comment');
  });
});
