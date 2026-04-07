
import 'dotenv/config';
import { createHttpServer } from './http/app';
import { SocketManager } from './socket/manager';
import { handleSpeechConnection } from '../routes/speech';
import { handleVoiceConnection } from '../routes/voice-bridge';
import { initVoiceProviders } from '../voice';
import { PORT } from '../utils/config';
import { WebSocketServer } from 'ws';
import { startReminderCron, stopReminderCron } from '../services/cloud-reminders';
import { ensureExecutionToolsRegistered } from '../orchestrator/execution-tools-bootstrap';

console.log('[cloud-ai] Starting server...');

// Initialize voice providers (ElevenLabs, OpenAI Realtime, etc.)
initVoiceProviders();

void ensureExecutionToolsRegistered().catch((error) => {
  console.warn('[cloud-ai] Failed to pre-register execution tools:', error);
});

const server = createHttpServer();
const socketManager = new SocketManager();
const speechWss = new WebSocketServer({ noServer: true });
const voiceWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';

  if (url === '/ws' || url.startsWith('/ws?')) {
    socketManager.handleUpgrade(req, socket, head);
  } else if (url === '/speech' || url.startsWith('/speech?')) {
    speechWss.handleUpgrade(req, socket, head, (ws) => {
       handleSpeechConnection(ws, req);
    });
  } else if (url === '/voice' || url.startsWith('/voice?')) {
    voiceWss.handleUpgrade(req, socket, head, (ws) => {
      handleVoiceConnection(ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
   console.log(`[cloud-ai] HTTP listening on http://0.0.0.0:${PORT}`);
   console.log(`[cloud-ai] WS endpoint at ws://<host>:${PORT}/ws`);

   // Start cloud reminder polling (processes overdue reminders immediately)
   startReminderCron();
});

// Handle cleanup
process.on('SIGTERM', () => {
  stopReminderCron();
  socketManager.cleanup();
  server.close();
});
