/**
 * Telnyx ↔ Voice Provider WebSocket Bridge
 *
 * Provider-agnostic telephony bridge that connects Telnyx media streaming
 * to any registered voice provider (ElevenLabs, OpenAI Realtime, etc.).
 *
 * Flow:
 *   1. Telnyx call webhook starts media streaming to /ws/telnyx-bridge
 *   2. Bridge parses query params to determine provider + config
 *   3. Creates a voice session via the provider registry
 *   4. Bridges audio bidirectionally: Telnyx ↔ Voice Provider
 *   5. Captures transcripts and stores call metadata
 *
 * Audio: Telnyx sends/receives PCMU (µ-law 8kHz), which all providers
 * support natively (ElevenLabs=ulaw_8000, OpenAI=g711_ulaw).
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { TELNYX_API_KEY } from '../../utils/config';
import {
  getVoiceProvider,
  getDefaultProviderId,
  registerActiveCall,
  removeActiveCall,
  type VoiceSessionConfig,
  type VoiceSession,
  type TelephonyBridgeConfig,
} from '../../voice';

const TELNYX_API = 'https://api.telnyx.com/v2';

export const telnyxBridgeWss = new WebSocketServer({ noServer: true });

interface BridgeParams {
  agentId?: string;
  providerId?: string;
  voiceId?: string;
  model?: string;
  initialMessage?: string;
  systemPrompt?: string;
  metadata?: Record<string, any>;
  userId?: string;
  callerNumber?: string;
  direction?: 'inbound' | 'outbound';
}

telnyxBridgeWss.on('connection', async (telnyxWs: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const callControlId = url.searchParams.get('callControlId') || '';
  const bridgeB64 = url.searchParams.get('bridge') || '';

  let params: BridgeParams = {};
  try {
    params = JSON.parse(Buffer.from(bridgeB64, 'base64').toString('utf8'));
  } catch {
    console.error('[telnyx-bridge] Invalid bridge config, closing.');
    telnyxWs.close(1008, 'invalid_bridge_config');
    return;
  }

  const providerId = params.providerId || getDefaultProviderId();
  const provider = getVoiceProvider(providerId);

  if (!provider) {
    console.error(`[telnyx-bridge] Unknown voice provider: ${providerId}`);
    telnyxWs.close(1008, 'unknown_provider');
    return;
  }

  if (!provider.isConfigured()) {
    console.error(`[telnyx-bridge] Provider ${providerId} is not configured`);
    telnyxWs.close(1008, 'provider_not_configured');
    return;
  }

  console.log('[telnyx-bridge] New bridge connection', {
    callControlId,
    providerId,
    agentId: params.agentId,
    direction: params.direction || 'outbound',
  });

  const transcripts: Array<{ role: string; text: string; timestamp: number }> = [];

  const sessionConfig: VoiceSessionConfig = {
    providerId,
    agentId: params.agentId,
    voiceId: params.voiceId,
    model: params.model,
    initialMessage: params.initialMessage,
    systemPrompt: params.systemPrompt,
    language: params.metadata?.language,
    metadata: params.metadata,
    inputAudioFormat: 'ulaw_8000',
    outputAudioFormat: 'ulaw_8000',
    onTranscript: (role, text, _isFinal) => {
      transcripts.push({ role, text, timestamp: Date.now() });
    },
    onSessionEnd: (reason) => {
      console.log('[telnyx-bridge] Voice session ended', { callControlId, reason });
      hangupCall(callControlId, streamId);
      if (telnyxWs.readyState === WebSocket.OPEN) telnyxWs.close(1000, 'session_ended');
    },
    onInterruption: () => {
      // Flush Telnyx's buffered audio so the caller immediately stops hearing
      // the old response when they start talking
      if (telnyxWs.readyState === WebSocket.OPEN && streamId) {
        telnyxWs.send(JSON.stringify({
          event: 'clear',
          stream_id: streamId,
        }));
      }
    },
  };

  let session: VoiceSession | null = null;
  let streamId = '';

  // Register the active call placeholder
  const bridgeConfig: TelephonyBridgeConfig = {
    callControlId,
    streamId: '',
    providerId,
    sessionConfig,
    userId: params.userId,
    callerNumber: params.callerNumber,
    direction: params.direction || 'outbound',
  };

  // ── Set up Telnyx WS handlers FIRST ──────────────────────────────────────
  // Telnyx sends the 'start' event (with stream_id) immediately on connect.
  // If we wait for createSession() before registering handlers, we miss it
  // and streamId stays empty → all outbound audio is silently dropped.
  telnyxWs.on('message', (rawData: Buffer | string) => {
    try {
      const msg = JSON.parse(rawData.toString());

      if (msg.event === 'start') {
        streamId = msg.start?.stream_id || msg.stream_id || '';
        bridgeConfig.streamId = streamId;
        console.log('[telnyx-bridge] Stream started', { streamId, callControlId, providerId });
      }

      if (msg.event === 'media' && msg.media?.track === 'inbound') {
        const audioB64 = msg.media?.payload;
        if (audioB64 && session?.isActive()) {
          session.sendAudio(audioB64);
        }
      }

      if (msg.event === 'stop') {
        console.log('[telnyx-bridge] Telnyx stream stopped', { streamId });
        if (session) session.close('stream_stopped');
      }
    } catch { /* ignore parse errors */ }
  });

  telnyxWs.on('close', () => {
    console.log('[telnyx-bridge] Telnyx WS closed', { callControlId, providerId });
    if (session) session.close('telnyx_closed');
    removeActiveCall(callControlId);
  });

  telnyxWs.on('error', (err) => {
    console.error('[telnyx-bridge] Telnyx WS error', err.message);
    if (session) session.close('telnyx_error');
    removeActiveCall(callControlId);
  });

  // ── Now create the provider session ──────────────────────────────────────
  try {
    session = await provider.createSession(sessionConfig);
  } catch (err: any) {
    console.error(`[telnyx-bridge] Failed to create ${providerId} session:`, err.message);
    telnyxWs.close(1011, 'session_creation_failed');
    return;
  }

  registerActiveCall(callControlId, { callControlId, session, bridgeConfig, startedAt: Date.now() });

  // Forward voice provider audio → Telnyx caller
  session.onAudio((audioBase64: string) => {
    if (telnyxWs.readyState === WebSocket.OPEN && streamId) {
      telnyxWs.send(JSON.stringify({
        event: 'media',
        stream_id: streamId,
        media: { payload: audioBase64 },
      }));
    }
  });
});

function hangupCall(callControlId: string, streamId: string): void {
  if (!callControlId || !TELNYX_API_KEY) return;

  if (streamId) {
    fetch(`${TELNYX_API}/calls/${callControlId}/actions/streaming_stop`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream_id: streamId }),
    }).catch(() => {});
  }

  setTimeout(() => {
    fetch(`${TELNYX_API}/calls/${callControlId}/actions/hangup`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    }).catch(() => {});
  }, 1000);
}
