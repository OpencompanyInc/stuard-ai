/**
 * VM Stream Mirror
 *
 * When a VM agent (Python) connects to cloud-ai WS for LLM streaming,
 * we mirror qualifying events to the user's desktop WS so the dashboard
 * CloudChatPanel renders real-time streaming updates.
 *
 * This module is shared between server.ts (where the mirror is set up)
 * and subagent-runtime.ts (where subagent events need mirroring too).
 */

import { WebSocket } from 'ws';

const _vmStreamMirrors = new WeakMap<WebSocket, WebSocket>();

/** Event types that should be mirrored to the desktop WS. */
const MIRROR_EVENT_TYPES = new Set([
  'progress',
  'final',
  'title',
  'conversation',
  'subagent_event',
]);

/**
 * Register a VM agent WS → desktop WS mirror pair.
 * Called when a VM agent authenticates on cloud-ai WS.
 */
export function setVMStreamMirror(vmWs: WebSocket, desktopWs: WebSocket): void {
  _vmStreamMirrors.set(vmWs, desktopWs);
}

/**
 * Get the desktop mirror WS for a VM agent WS, if any.
 */
export function getVMStreamMirror(vmWs: WebSocket): WebSocket | undefined {
  const mirror = _vmStreamMirrors.get(vmWs);
  if (mirror && mirror.readyState === WebSocket.OPEN && mirror !== vmWs) return mirror;
  return undefined;
}

/**
 * Mirror an event payload to the desktop WS if one is registered.
 * Automatically tags with vmMirror: true.
 */
export function mirrorToDesktop(vmWs: WebSocket, data: any, requestId?: string): void {
  const mirror = getVMStreamMirror(vmWs);
  if (!mirror) return;
  if (!data?.type || !MIRROR_EVENT_TYPES.has(data.type)) return;
  try {
    const payload = {
      ...(requestId ? { ...data, requestId } : data),
      vmMirror: true,
    };
    mirror.send(JSON.stringify(payload));
  } catch { }
}
