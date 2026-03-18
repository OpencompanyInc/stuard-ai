/**
 * Browser ↔ Voice Provider WebSocket Bridge
 *
 * Allows the desktop/browser client to have a real-time voice conversation
 * with any registered voice provider (OpenAI Realtime, ElevenLabs, Gemini, Grok).
 *
 * Protocol:
 *   1. Client sends JSON auth message: { type: "auth", accessToken: "..." }
 *   2. Client sends JSON config: { type: "config", provider, voice, systemPrompt, model }
 *   3. Server responds { type: "ready" } when provider session is established
 *   4. Client sends binary PCM16 24kHz audio chunks
 *   5. Server sends binary PCM16 24kHz audio back + JSON transcript messages
 *   6. Either side can close the connection
 */

import { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { verifyToken } from '../supabase';
import { writeLog } from '../utils/logger';
import {
  getVoiceProvider,
  getConfiguredProviders,
  getDefaultProviderId,
  type VoiceSession,
  type VoiceSessionConfig,
} from '../voice';

interface VoiceBridgeConfig {
  provider?: string;
  voice?: string;
  model?: string;
  systemPrompt?: string;
  initialMessage?: string;
}

export function handleVoiceConnection(ws: WebSocket, _req: IncomingMessage) {
  let session: VoiceSession | null = null;
  let authenticated = false;
  let userId: string | null = null;
  let isClosed = false;

  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      send(ws, { type: 'error', message: 'auth_timeout' });
      ws.close();
    }
  }, 10000);

  // Send list of available providers on connect
  const providers = getConfiguredProviders().map(p => ({ id: p.id, name: p.name }));
  send(ws, { type: 'providers', providers, default: getDefaultProviderId() });

  ws.on('message', async (data: Buffer | string) => {
    if (isClosed) return;

    // Binary data = audio from mic
    if (Buffer.isBuffer(data) && authenticated && session) {
      // Convert raw PCM16 buffer to base64 for the provider
      session.sendAudio(data.toString('base64'));
      return;
    }

    // JSON control messages
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    // Step 1: Auth
    if (!authenticated && msg.type === 'auth') {
      try {
        const user = await verifyToken(msg.accessToken);
        if (user) {
          authenticated = true;
          userId = user.userId;
          clearTimeout(authTimeout);
          send(ws, { type: 'authenticated' });
          writeLog('voice_bridge_connected', { userId });
        } else {
          send(ws, { type: 'error', message: 'unauthorized' });
          ws.close();
        }
      } catch {
        send(ws, { type: 'error', message: 'auth_failed' });
        ws.close();
      }
      return;
    }

    if (!authenticated) {
      send(ws, { type: 'error', message: 'auth_required' });
      return;
    }

    // Step 2: Start session with provider
    if (msg.type === 'config') {
      if (session) {
        session.close('reconfigured');
        session = null;
      }

      const config = msg as VoiceBridgeConfig;
      const providerId = config.provider || getDefaultProviderId();
      const provider = getVoiceProvider(providerId);

      if (!provider) {
        send(ws, { type: 'error', message: `provider_not_found: ${providerId}` });
        return;
      }

      if (!provider.isConfigured()) {
        send(ws, { type: 'error', message: `provider_not_configured: ${providerId}` });
        return;
      }

      try {
        const sessionConfig: VoiceSessionConfig = {
          providerId,
          voiceId: config.voice,
          model: config.model,
          systemPrompt: config.systemPrompt || 'You are Stuard, a helpful AI assistant. Always respond in English. Keep responses concise and conversational.',
          language: 'en',
          initialMessage: config.initialMessage,
          // Browser sends/receives PCM16 at 24kHz
          inputAudioFormat: 'pcm_24000',
          outputAudioFormat: 'pcm_24000',
          onTranscript: (role, text, isFinal) => {
            if (!isClosed) {
              send(ws, { type: 'transcript', role, text, isFinal });
            }
          },
          onSessionEnd: (reason) => {
            if (!isClosed) {
              send(ws, { type: 'session_ended', reason });
            }
          },
          onInterruption: () => {
            if (!isClosed) {
              send(ws, { type: 'interruption' });
            }
          },
        };

        session = await provider.createSession(sessionConfig);

        // Bridge audio from provider back to browser as binary PCM16
        session.onAudio((audioBase64: string) => {
          if (!isClosed && ws.readyState === WebSocket.OPEN) {
            const buf = Buffer.from(audioBase64, 'base64');
            ws.send(buf);
          }
        });

        send(ws, { type: 'ready', provider: providerId, sessionId: session.id });
        writeLog('voice_session_started', { userId, provider: providerId, sessionId: session.id });
      } catch (err: any) {
        console.error('[voice-bridge] Session creation failed:', err?.message);
        send(ws, { type: 'error', message: `session_failed: ${err?.message || 'unknown'}` });
      }
      return;
    }

    // Text injection
    if (msg.type === 'text' && session?.sendText) {
      session.sendText(msg.text || '');
      return;
    }

    // Interrupt
    if (msg.type === 'interrupt' && session?.interrupt) {
      session.interrupt();
      return;
    }

    // Close
    if (msg.type === 'close') {
      cleanup('client_close');
      ws.close();
      return;
    }
  });

  ws.on('close', () => {
    cleanup('ws_closed');
  });

  ws.on('error', (err) => {
    console.error('[voice-bridge] WS error:', err.message);
    cleanup('ws_error');
  });

  function cleanup(reason: string) {
    if (isClosed) return;
    isClosed = true;
    clearTimeout(authTimeout);
    if (session) {
      try { session.close(reason); } catch {}
      session = null;
    }
    writeLog('voice_bridge_disconnected', { userId: userId || 'unauth', reason });
  }
}

function send(ws: WebSocket, data: any) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch {}
}
