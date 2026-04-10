import { createHttpServer } from './http/app';
import { createChatWebSocketServer } from './socket/server';
import { handleSpeechConnection } from '../routes/speech';
import { PORT } from '../utils/config';
import { warmupGroupCache } from '../utils/tool-groups';
import { ensureToolEmbeddings } from '../tools/meta-tools';
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

  server.listen(PORT, () => {
    try {
      warmupGroupCache();
    } catch { }

    try {
      const eager = String(process.env.CLOUD_EAGER_TOOL_EMBEDDINGS_SYNC || '').trim().toLowerCase();
      if (eager === '1' || eager === 'true' || eager === 'yes') {
        console.log('[cloud-ai] Eager tool embeddings sync enabled');
        ensureToolEmbeddings()
          .then(() => console.log('[cloud-ai] Tool embeddings sync complete'))
          .catch((error) => console.warn('[cloud-ai] Tool embeddings sync failed', error));
      }
    } catch { }

    try {
      startVMHealthMonitor();
      console.log('[cloud-ai] VM health monitor started');
    } catch (error) {
      console.warn('[cloud-ai] VM health monitor failed to start:', error);
    }
  });

  return { server, wss };
}
