import type { WebSocket } from 'ws';

export const conversations = new WeakMap<WebSocket, Array<any>>();
export const wsConversations = new WeakMap<WebSocket, string>();
export const anonResources = new WeakMap<WebSocket, string>();
export const anonThreads = new WeakMap<WebSocket, string>();
export const wsAlive = new WeakMap<WebSocket, boolean>();

const wsAbortControllers = new WeakMap<WebSocket, Map<string, AbortController>>();
const wsInterjections = new WeakMap<WebSocket, Map<string, Array<{ text: string; timestamp: number }>>>();

function getAbortKey(requestId: string | undefined) {
  return requestId || '__default__';
}

export function getAbortMap(ws: WebSocket): Map<string, AbortController> {
  let controllers = wsAbortControllers.get(ws);
  if (!controllers) {
    controllers = new Map();
    wsAbortControllers.set(ws, controllers);
  }
  return controllers;
}

export function setAbortController(ws: WebSocket, requestId: string | undefined, controller: AbortController) {
  getAbortMap(ws).set(getAbortKey(requestId), controller);
}

export function deleteAbortController(ws: WebSocket, requestId: string | undefined) {
  const controllers = wsAbortControllers.get(ws);
  if (!controllers) return;

  controllers.delete(getAbortKey(requestId));
  if (controllers.size === 0) {
    wsAbortControllers.delete(ws);
  }
}

export function abortAndCleanup(ws: WebSocket, requestId: string | undefined) {
  const controllers = wsAbortControllers.get(ws);
  if (!controllers) return false;

  const controller = controllers.get(getAbortKey(requestId));
  if (!controller) return false;

  controller.abort();
  controllers.delete(getAbortKey(requestId));
  if (controllers.size === 0) {
    wsAbortControllers.delete(ws);
  }
  return true;
}

export function abortAllRequests(ws: WebSocket) {
  const controllers = wsAbortControllers.get(ws);
  if (!controllers || controllers.size === 0) return 0;

  const count = controllers.size;
  for (const [, controller] of controllers) {
    try {
      controller.abort();
    } catch { }
  }
  controllers.clear();
  wsAbortControllers.delete(ws);
  return count;
}

export function enqueueInterjection(ws: WebSocket, requestId: string | undefined, text: string) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;

  const key = getAbortKey(requestId);
  let byRequest = wsInterjections.get(ws);
  if (!byRequest) {
    byRequest = new Map();
    wsInterjections.set(ws, byRequest);
  }

  const queue = byRequest.get(key) || [];
  queue.push({ text: trimmed, timestamp: Date.now() });
  byRequest.set(key, queue);
  return queue.length;
}

export function drainInterjections(ws: WebSocket, requestId: string | undefined) {
  const byRequest = wsInterjections.get(ws);
  if (!byRequest) return [];

  const key = getAbortKey(requestId);
  const queue = byRequest.get(key) || [];
  byRequest.delete(key);
  if (byRequest.size === 0) {
    wsInterjections.delete(ws);
  }
  return queue;
}

export function cleanupSocketState(ws: WebSocket) {
  abortAllRequests(ws);
  conversations.delete(ws);
  wsConversations.delete(ws);
  anonResources.delete(ws);
  anonThreads.delete(ws);
  wsAlive.delete(ws);
  wsInterjections.delete(ws);
}
