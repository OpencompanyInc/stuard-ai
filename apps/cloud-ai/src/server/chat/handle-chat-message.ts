import type { WebSocket } from 'ws';

import { withClientBridge } from '../../tools/bridge';
import { writeLog } from '../../utils/logger';
import { send } from '../socket/helpers';
import { deleteAbortController } from '../socket/state';
import { prepareChatRequest } from './prepare-chat-request';
import { runPreparedChatStream } from './stream-runner';

/**
 * Dispatch a chat WS message. This is fire-and-forget from the connection
 * handler — the returned promise is intentionally not awaited so the socket
 * read loop stays responsive. That means an uncaught rejection here would
 * propagate as an unhandledRejection and (under Node's default policy) kill
 * the process, so the inner promise MUST be wrapped.
 *
 * A common failure mode is `getModelForUser` throwing because an upstream
 * decryption (BYOK / codex_subscription) failed — that's a per-request
 * error, not a fatal one. We surface it to the desktop as a normal error +
 * final/aborted pair so the UI unfreezes, then return.
 */
export function handleChatMessage(
  ws: WebSocket,
  msg: any,
  requestId: string | undefined,
  secretBag: Record<string, any>,
) {
  const run = withClientBridge(ws, async () => {
    const prepared = await prepareChatRequest({
      ws,
      msg,
      requestId,
      secretBag,
    });
    if (!prepared) return;

    await runPreparedChatStream(prepared);
  }, secretBag) as Promise<unknown>;

  run.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    writeLog('chat_handler_failed', {
      requestId,
      error: message,
      stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
    });
    try {
      console.error('[cloud-ai] chat handler failed', err);
    } catch { }

    // Tell the desktop the turn ended so the UI doesn't sit on a spinner.
    // Send both error + final/aborted — the desktop reads either to clear
    // the streaming state.
    try {
      send(ws, { type: 'error', message }, requestId);
    } catch { }
    try {
      send(
        ws,
        {
          type: 'final',
          origin: 'cloud-ai',
          result: { text: '', finishReason: 'error', error: message },
          aborted: true,
        },
        requestId,
      );
    } catch { }

    // Release any abort controller registered for this requestId so it
    // doesn't leak across requests.
    try {
      deleteAbortController(ws, requestId);
    } catch { }
  });
}
