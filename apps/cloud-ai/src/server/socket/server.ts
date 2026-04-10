import { WebSocket, WebSocketServer } from 'ws';

import { PING_INTERVAL_MS } from '../../utils/config';
import { writeLog } from '../../utils/logger';
import { handleSocketConnection } from './connection-handler';
import { wsAlive } from './state';

const WS_MAX_PAYLOAD = Number(process.env.CLOUD_WS_MAX_PAYLOAD || 868435456);

export function createChatWebSocketServer() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });
  const pingTimer = setInterval(() => {
    try {
      wss.clients.forEach((client: WebSocket) => {
        const alive = wsAlive.get(client);
        if (alive === false) {
          writeLog('ws_terminate_due_to_no_pong');
          try {
            client.terminate();
          } catch { }
          wsAlive.delete(client);
          return;
        }

        wsAlive.set(client, false);
        try {
          client.ping();
        } catch { }
      });
    } catch { }
  }, PING_INTERVAL_MS);

  wss.on('connection', handleSocketConnection);

  return {
    wss,
    cleanup: () => {
      try {
        clearInterval(pingTimer);
      } catch { }
    },
  };
}
