import { createHttpServer } from './http/app';
import { createChatWebSocketServer } from './socket/server';
import { ensureExecutionToolsRegistered } from '../orchestrator/execution-tools-bootstrap';
import { handleSpeechConnection } from '../routes/speech';
import { PORT } from '../utils/config';
import { startVMHealthMonitor } from '../services/vm-health';

export function startCloudAiServer() {
  const server = createHttpServer();
  const { wss, cleanup } = createChatWebSocketServer();

  server.on('close', cleanup);
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (url === '/ws' || url.startsWith('/ws?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else if (url === '/speech' || url.startsWith('/speech?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleSpeechConnection(ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  void ensureExecutionToolsRegistered().catch((error) => {
    console.warn('[cloud-ai] Failed to pre-register execution tools:', error);
  });

  server.listen(PORT, () => {
    try {
      startVMHealthMonitor();
      console.log('[cloud-ai] VM health monitor started');
    } catch (error) {
      console.warn('[cloud-ai] VM health monitor failed to start:', error);
    }
  });

  return { server, wss };
}
