import type { WebSocket } from 'ws';

import { withClientBridge } from '../../tools/bridge';
import { prepareChatRequest } from './prepare-chat-request';
import { runPreparedChatStream } from './stream-runner';

export function handleChatMessage(
  ws: WebSocket,
  msg: any,
  requestId: string | undefined,
  secretBag: Record<string, any>,
) {
  withClientBridge(ws, async () => {
    const prepared = await prepareChatRequest({
      ws,
      msg,
      requestId,
      secretBag,
    });
    if (!prepared) return;

    await runPreparedChatStream(prepared);
  }, secretBag);
}
