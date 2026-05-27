import type { IncomingMessage } from 'http';
import { WebSocket } from 'ws';

import { handleClientToolMessage } from '../../tools/bridge';
import { writeLog } from '../../utils/logger';
import { handleChatMessage } from '../chat/handle-chat-message';
import { handleAuthMessage } from './auth-handler';
import { handleBridgedToolExecution } from './bridged-tool-handler';
import { abortAndCleanup, cleanupSocketState, conversations, countActiveRequests, enqueueInterjection, getOnlyActiveRequestId, wsAlive } from './state';
import { extractClientType, extractQueryParam, send } from './helpers';
import { abortRunningSubagentsForRequest, enqueueSubagentSteer, isSubagentRunning } from '../../orchestrator/subagent-runtime';
import { abortHeadlessTasksForRequest } from '../../tools/deploy-headless-agent';

export function handleSocketConnection(ws: WebSocket, req: IncomingMessage) {
  try {
    const rawUrl = String(req?.url || '');
    const clientType = extractClientType(rawUrl);
    if (clientType) {
      (ws as any).__clientType = clientType;
    }
    const voiceSession = extractQueryParam(rawUrl, 'voice_session');
    if (voiceSession) {
      (ws as any).__voiceSession = voiceSession;
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
      try { abortRunningSubagentsForRequest(ws, undefined, 'socket_closed'); } catch { }
      try { abortHeadlessTasksForRequest(ws, undefined, 'socket_closed'); } catch { }
      cleanupSocketState(ws, 'socket_closed');
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
      const aborted = abortAndCleanup(ws, stopRequestId, 'client_stop');
      const subagentsAborted = abortRunningSubagentsForRequest(ws, stopRequestId, 'client_stop');
      const headlessAborted = abortHeadlessTasksForRequest(ws, stopRequestId, 'client_stop');
      console.log(`[cloud-ai] Aborting stream for requestId=${stopRequestId}: ${aborted} | subagents=${subagentsAborted} | headless=${headlessAborted}`);
      send(ws, { type: 'stopped', success: aborted || subagentsAborted > 0 || headlessAborted > 0, requestId: stopRequestId, subagentsAborted, headlessAborted });
    } else {
      // No requestId provided. To avoid wiping out parallel streams from other
      // tabs on a shared socket, only auto-abort when exactly one stream is in
      // flight (unambiguous target). Otherwise refuse and require a requestId.
      const activeCount = countActiveRequests(ws);
      if (activeCount > 1) {
        console.log(`[cloud-ai] Refusing bare stop: ${activeCount} active streams — requestId required to disambiguate`);
        send(ws, { type: 'stopped', success: false, message: 'requestId required: multiple active streams', activeCount });
        return;
      }
      if (activeCount !== 1) {
        send(ws, { type: 'stopped', success: false, message: 'no active stream' });
        return;
      }

      const soleRequestId = getOnlyActiveRequestId(ws);
      const aborted = abortAndCleanup(ws, soleRequestId, 'client_stop');
      const subagentsAborted = soleRequestId
        ? abortRunningSubagentsForRequest(ws, soleRequestId, 'client_stop')
        : 0;
      const headlessAborted = soleRequestId
        ? abortHeadlessTasksForRequest(ws, soleRequestId, 'client_stop')
        : 0;
      if (aborted || subagentsAborted > 0 || headlessAborted > 0) {
        console.log(`[cloud-ai] Bare stop aborted sole active work: stream=${aborted} requestId=${soleRequestId || '∅'} subagents=${subagentsAborted} headless=${headlessAborted}`);
        send(ws, { type: 'stopped', success: true, requestId: soleRequestId, subagentsAborted, headlessAborted });
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

  if (kind === 'interjection' || kind === 'steer') {
    const requestId = typeof msg?.requestId === 'string' ? msg.requestId : undefined;
    const text = typeof msg?.text === 'string' ? msg.text : '';
    const depth = enqueueInterjection(ws, requestId, text);
    send(ws, {
      type: 'interjection_ack',
      accepted: depth > 0,
      depth,
      message: depth > 0 ? 'queued for next step' : 'empty interjection',
    }, requestId);
    return;
  }

  if (kind === 'subagent_steer') {
    const subagentId = typeof msg?.subagentId === 'string' ? msg.subagentId.trim() : '';
    const text = typeof msg?.text === 'string' ? msg.text : '';
    const requestId = typeof msg?.requestId === 'string' ? msg.requestId : undefined;
    // Reject early when the target subagent isn't running so the steer
    // doesn't sit forever in subagentSteerQueues. Otherwise the user
    // would get a misleading accepted=true ack for a no-op.
    const subagentAlive = subagentId ? isSubagentRunning(subagentId) : false;
    const depth = subagentId && subagentAlive ? enqueueSubagentSteer(subagentId, text) : 0;
    let ackMessage: string;
    if (!subagentId) ackMessage = 'subagentId required';
    else if (!subagentAlive) ackMessage = 'subagent_not_running';
    else if (depth === 0) ackMessage = 'empty steer';
    else ackMessage = 'queued for next subagent step';
    send(ws, {
      type: 'subagent_steer_ack',
      subagentId,
      accepted: depth > 0,
      depth,
      message: ackMessage,
    }, requestId);
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
