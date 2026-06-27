import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, jsonMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  jsonMock: vi.fn(),
}));

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock,
  },
}));

import { aiDecideNext } from './ai';

describe('aiDecideNext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock.mockResolvedValue({ next: 'step_b' });
    fetchMock.mockResolvedValue({
      ok: true,
      json: jsonMock,
    });
  });

  it('forwards the workflow access token to cloud inference routing', async () => {
    const result = await aiDecideNext(
      { id: 'flow_1' } as any,
      { id: 'step_a' } as any,
      { foo: 'bar' },
      [{ to: 'step_b', label: 'B' }],
      {},
      {
        stuardsDir: 'C:/tmp/stuards',
        cloudAiUrl: 'https://cloud.example.com',
        agentWsUrl: 'ws://localhost:8765/ws',
        accessToken: 'token-123',
        logFn: vi.fn(),
      },
    );

    expect(result).toEqual({ ok: true, next: 'step_b', argsPatch: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cloud.example.com/inference/workflow/next',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-123',
        }),
      }),
    );
  });
});
