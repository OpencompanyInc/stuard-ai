import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createClientMock,
  setSessionMock,
  signOutMock,
  setAuthMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  setSessionMock: vi.fn(),
  signOutMock: vi.fn(),
  setAuthMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

vi.mock('ws', () => ({
  default: class MockWebSocket {},
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function loadAuthSessionModule() {
  vi.resetModules();
  return import('./auth-session');
}

function makeSession() {
  return {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    user: { id: 'user-1' },
  } as any;
}

describe('auth-session sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSessionMock.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });
    signOutMock.mockResolvedValue(undefined);
    setAuthMock.mockImplementation(() => {});
    createClientMock.mockReturnValue({
      auth: {
        setSession: setSessionMock,
        signOut: signOutMock,
      },
      realtime: {
        setAuth: setAuthMock,
      },
    });
  });

  it('does not re-emit unchanged sessions', async () => {
    const session = makeSession();
    const { onMainAuthSessionChange, syncMainAuthSession } = await loadAuthSessionModule();
    const listener = vi.fn();
    const unsubscribe = onMainAuthSessionChange(listener);

    await expect(syncMainAuthSession(session)).resolves.toEqual({ ok: true });
    await expect(syncMainAuthSession(session)).resolves.toEqual({ ok: true });

    expect(setSessionMock).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(session);

    unsubscribe();
  });
});
