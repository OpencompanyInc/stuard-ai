import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setAbortController } from './state';

const mocks = vi.hoisted(() => ({
  abortRunningSubagentsForRequest: vi.fn(() => 0),
  abortHeadlessTasksForRequest: vi.fn(() => 0),
  enqueueSubagentSteer: vi.fn(() => 0),
  isSubagentRunning: vi.fn(() => false),
}));

vi.mock('../../tools/bridge', () => ({
  handleClientToolMessage: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  writeLog: vi.fn(),
}));

vi.mock('../chat/handle-chat-message', () => ({
  handleChatMessage: vi.fn(),
}));

vi.mock('./auth-handler', () => ({
  handleAuthMessage: vi.fn(),
}));

vi.mock('./bridged-tool-handler', () => ({
  handleBridgedToolExecution: vi.fn(),
}));

vi.mock('../../orchestrator/subagent-runtime', () => ({
  abortRunningSubagentsForRequest: mocks.abortRunningSubagentsForRequest,
  enqueueSubagentSteer: mocks.enqueueSubagentSteer,
  isSubagentRunning: mocks.isSubagentRunning,
}));

vi.mock('../../tools/deploy-headless-agent', () => ({
  abortHeadlessTasksForRequest: mocks.abortHeadlessTasksForRequest,
}));

const { handleSocketConnection } = await import('./connection-handler');

class FakeWebSocket extends EventEmitter {
  sent: any[] = [];

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
}

function connectFakeSocket() {
  const ws = new FakeWebSocket();
  handleSocketConnection(ws as any, { url: '/ws' } as IncomingMessage);
  return ws;
}

function sendJson(ws: FakeWebSocket, payload: any) {
  ws.emit('message', Buffer.from(JSON.stringify(payload)));
}

describe('handleSocketConnection stop routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fan out a bare stop to delegated sessions when no request is active', () => {
    const ws = connectFakeSocket();

    sendJson(ws, { type: 'stop' });

    expect(mocks.abortRunningSubagentsForRequest).not.toHaveBeenCalled();
    expect(mocks.abortHeadlessTasksForRequest).not.toHaveBeenCalled();
    expect(ws.sent.at(-1)).toMatchObject({
      type: 'stopped',
      success: false,
      message: 'no active stream',
    });
  });

  it('scopes a bare stop to the sole active request', () => {
    const ws = connectFakeSocket();
    setAbortController(ws as any, 'req-1', new AbortController());

    sendJson(ws, { type: 'stop' });

    expect(mocks.abortRunningSubagentsForRequest).toHaveBeenCalledWith(ws, 'req-1', 'client_stop');
    expect(mocks.abortHeadlessTasksForRequest).toHaveBeenCalledWith(ws, 'req-1', 'client_stop');
    expect(ws.sent.at(-1)).toMatchObject({
      type: 'stopped',
      success: true,
      requestId: 'req-1',
    });
  });
});
