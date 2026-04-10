import type { IncomingMessage } from 'http';
import { WebSocket } from 'ws';

import { handleClientToolMessage } from '../../tools/bridge';
import { writeLog } from '../../utils/logger';
import { handleChatMessage } from '../chat/handle-chat-message';
import { handleAuthMessage } from './auth-handler';
import { handleBridgedToolExecution } from './bridged-tool-handler';
import { abortAllRequests, abortAndCleanup, cleanupSocketState, conversations, wsAlive } from './state';
import { extractClientType, send } from './helpers';

export function handleSocketConnection(ws: WebSocket, req: IncomingMessage) {
  try {
    const clientType = extractClientType(String(req?.url || ''));
    if (clientType) {
      (ws as any).__clientType = clientType;
    }
  } catch { }

  send(ws, { type: 'handshake', origin: 'cloud-ai', message: 'connected' });
  conversations.set(ws, []);
  writeLog('ws_connected');

  try {
    wsAlive.set(ws, true);
  } catch { }

  try {
    ws.on('pong', () => {
      try {
        wsAlive.set(ws, true);
      } catch { }
    });
  } catch { }

  try {
    ws.on('close', () => {
      writeLog('ws_disconnected');
      cleanupSocketState(ws);
    });
  } catch { }

  ws.on('message', async (rawData: WebSocket.RawData) => {
    await handleSocketMessage(ws, rawData);
  });
}

async function handleSocketMessage(ws: WebSocket, rawData: WebSocket.RawData) {
  let msg: any;
  try {
    msg = JSON.parse(Buffer.isBuffer(rawData) ? rawData.toString('utf8') : String(rawData));
  } catch {
    send(ws, { type: 'error', message: 'invalid json' });
    return;
  }

  const kind = String(msg?.type || '').toLowerCase();
  if (kind === 'tool_event' || kind === 'tool_result') {
    try {
      handleClientToolMessage(ws, msg);
    } catch { }
    return;
  }

  if (kind === 'stop' || kind === 'abort') {
    const stopRequestId = typeof msg?.requestId === 'string' ? msg.requestId : undefined;
    if (stopRequestId) {
      const aborted = abortAndCleanup(ws, stopRequestId);
      console.log(`[cloud-ai] Aborting stream for requestId=${stopRequestId}: ${aborted}`);
      send(ws, { type: 'stopped', success: aborted, requestId: stopRequestId });
    } else {
      const abortedCount = abortAllRequests(ws);
      if (abortedCount > 0) {
        console.log(`[cloud-ai] Aborting ALL ${abortedCount} stream(s) by user request`);
        send(ws, { type: 'stopped', success: true });
      } else {
        send(ws, { type: 'stopped', success: false, message: 'no active stream' });
      }
    }
    return;
  }

  if (kind === 'exec_tool_bridged') {
    void handleBridgedToolExecution(ws, msg);
    return;
  }

  if (kind === 'auth') {
    await handleAuthMessage(ws, msg);
    return;
  }

  if (kind !== 'chat') {
    send(ws, { type: 'error', message: `unknown type: ${kind}` });
    return;
  }

  const requestId = typeof msg?.requestId === 'string' ? msg.requestId : undefined;
  const secretBag = extractSecretBag(msg);
  handleChatMessage(ws, msg, requestId, secretBag);
}

function extractSecretBag(msg: any) {
  const secretBag: Record<string, any> = {};

  try {
    const incomingContext: any = msg?.context || {};
    const outlookAccessToken = incomingContext?.outlookAccessToken;
    if (typeof outlookAccessToken === 'string' && outlookAccessToken) {
      secretBag.outlookAccessToken = outlookAccessToken;
      try {
        delete incomingContext.outlookAccessToken;
      } catch { }
      try {
        msg.context = incomingContext;
      } catch { }
    }

    try {
      msg.__deviceId = typeof incomingContext?.deviceId === 'string' ? incomingContext.deviceId : undefined;
    } catch { }

    const incomingSkills = Array.isArray(incomingContext?.skills) ? incomingContext.skills : [];
    if (incomingSkills.length > 0) {
      secretBag.__skills = incomingSkills;
    }
  } catch { }

  return secretBag;
}
