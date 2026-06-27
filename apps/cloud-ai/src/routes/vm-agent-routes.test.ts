import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({
  verifyToken: vi.fn(async () => ({ userId: 'user-1' })),
  getCloudEngine: vi.fn(async () => ({ status: 'running' })),
}));

vi.mock('../services/vm-command', () => ({
  resolveVMBaseUrl: vi.fn(async () => 'http://vm-agent.test'),
  resolveVMSecret: vi.fn(async () => 'secret'),
  isVMAgentReachableCached: vi.fn(async () => true),
  isVMChatReadyCached: vi.fn(async () => true),
  sendVMCommand: vi.fn(),
}));

vi.mock('../services/vm-tokens', () => ({
  mintVMToken: vi.fn(() => 'vm-token'),
}));

import { handleVMAgentRoutes } from './vm-agent-routes';

class MockReq extends EventEmitter {
  method = 'POST';
  headers = { authorization: 'Bearer user-token' };
}

class MockRes extends EventEmitter {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  writableEnded = false;

  writeHead(statusCode: number, headers: Record<string, string>) {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  write(chunk: string) {
    this.chunks.push(String(chunk));
    return true;
  }

  end(chunk?: string) {
    if (chunk) this.write(chunk);
    this.writableEnded = true;
    this.emit('finish');
  }
}

describe('handleVMAgentRoutes chat streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not abort the VM stream when the incoming request closes after upload', async () => {
    const req = new MockReq();
    const res = new MockRes();
    let upstreamSignal: AbortSignal | undefined;

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      upstreamSignal = init?.signal as AbortSignal | undefined;
      req.emit('close');
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(
              '{"type":"final","result":{"text":"still here"}}\n',
            ));
            controller.close();
          },
        }),
        { status: 200 },
      );
    }));

    const handled = handleVMAgentRoutes(
      req as any,
      res as any,
      new URL('https://api.test/v1/vm/agent/chat'),
    );

    await vi.waitFor(() => expect(req.listenerCount('end')).toBeGreaterThan(0));
    req.emit('data', Buffer.from(JSON.stringify({ message: 'hey' })));
    req.emit('end');

    await handled;

    expect(upstreamSignal?.aborted).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.chunks.join('')).toContain('"still here"');
  });
});
