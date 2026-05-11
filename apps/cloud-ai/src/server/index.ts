import { createHttpServer } from './http/app';
import { createChatWebSocketServer, createManagedWebSocketServer } from './socket/server';
import { ensureExecutionToolsRegistered } from '../orchestrator/execution-tools-bootstrap';
import { handleSpeechConnection } from '../routes/speech';
import { handleTerminalConnection } from '../routes/terminal-relay';
import { handleCloudPreviewWsUpgrade } from '../routes/cloud-preview';
import { handleVoiceConnection } from '../routes/voice-bridge';
import { PORT } from '../utils/config';
import { startVMHealthMonitor } from '../services/vm-health';
import { initVoiceProviders } from '../voice';
import { telnyxBridgeWss } from '../routes/integrations/telnyx-bridge';
import { verifyTelnyxConfig } from '../routes/integrations/telnyx';
import { startReminderCron } from '../services/cloud-reminders';

export function startCloudAiServer() {
  initVoiceProviders();

  const server = createHttpServer();
  const { wss, cleanup } = createChatWebSocketServer();
  const { wss: voiceWss, cleanup: cleanupVoice } = createManagedWebSocketServer(handleVoiceConnection);

  server.on('close', () => {
    cleanup();
    cleanupVoice();
  });
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (url === '/ws/telnyx-bridge' || url.startsWith('/ws/telnyx-bridge?')) {
      telnyxBridgeWss.handleUpgrade(req, socket, head, (ws) => {
        telnyxBridgeWss.emit('connection', ws, req);
      });
    } else if (url === '/voice' || url.startsWith('/voice?')) {
      voiceWss.handleUpgrade(req, socket, head, (ws) => {
        voiceWss.emit('connection', ws, req);
      });
    } else if (url === '/ws' || url.startsWith('/ws?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else if (url === '/speech' || url.startsWith('/speech?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleSpeechConnection(ws, req);
      });
    } else if (url === '/terminal' || url.startsWith('/terminal?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleTerminalConnection(ws, req);
      });
    } else if (url.startsWith('/v1/cloud-engine/preview/')) {
      // HMR & other dev-server WebSockets relayed end-to-end to the VM.
      let parsedUrl: URL;
      try { parsedUrl = new URL(url, 'http://localhost'); }
      catch { socket.destroy(); return; }
      void handleCloudPreviewWsUpgrade(req, socket, head, parsedUrl).then((handled) => {
        if (!handled) {
          try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); } catch {}
          socket.destroy();
        }
      }).catch(() => {
        try { socket.destroy(); } catch {}
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
    try {
      startReminderCron();
    } catch (error) {
      console.warn('[cloud-ai] Reminder cron failed to start:', error);
    }
    void verifyTelnyxConfig().catch((error) => {
      console.warn('[cloud-ai] Telnyx config verification failed:', error);
    });
  });

  return { server, wss };
}
