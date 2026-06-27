import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:\\Users\\test\\AppData\\Roaming\\StuardAI'),
    getAppPath: vi.fn(() => 'C:\\repo\\apps\\desktop'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

describe('browser-use session routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps tab sessions on the default browser runtime and forwards tab routing in the request body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        ok: true,
        installed: true,
        running: true,
        mode: 'headed',
        profile: 'default',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const { execBrowserUseNavigate } = await import('../handlers/browser-use');

    await execBrowserUseNavigate(
      { url: 'https://example.com/a', session_id: 'browser-run-a', tab_index: 0 },
      {} as any,
    );
    await execBrowserUseNavigate(
      { url: 'https://example.com/b', session_id: 'browser-run-b', tab_index: 1 },
      {} as any,
    );

    const navigateCalls = calls.filter((call) => call.url.endsWith('/navigate'));
    expect(navigateCalls).toHaveLength(2);

    const firstBase = navigateCalls[0].url.replace(/\/navigate$/, '');
    const secondBase = navigateCalls[1].url.replace(/\/navigate$/, '');
    expect(firstBase).toBe(secondBase);

    expect(JSON.parse(String(navigateCalls[0].init?.body))).toMatchObject({
      url: 'https://example.com/a',
      session_id: 'browser-run-a',
      tab_index: 0,
    });
    expect(JSON.parse(String(navigateCalls[1].init?.body))).toMatchObject({
      url: 'https://example.com/b',
      session_id: 'browser-run-b',
      tab_index: 1,
    });
  });
});
