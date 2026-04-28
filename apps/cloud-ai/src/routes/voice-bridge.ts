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
 *
 * The browser session reuses the orchestrator-style voice context (system
 * prompt + tool surface) and forwards tool call activity back to the UI so
 * the user sees what's happening in real time.
 */

import { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { verifyToken } from '../supabase';
import { writeLog } from '../utils/logger';
import {
  getVoiceProvider,
  getConfiguredProviders,
  getDefaultProviderId,
  supportsVoiceToolCalling,
  findToolCapableVoiceProvider,
  buildVoiceContext,
  type VoiceSession,
  type VoiceSessionConfig,
} from '../voice';
import {
  executeVoiceToolCall,
  truncateVoiceToolResult,
} from '../voice/voice-runtime-tools';
import {
  registerVoiceBridge,
  cleanupVoiceBridge,
  awaitVoiceBridge,
  getVoiceBridgeWs,
} from '../voice/voice-bridge-manager';
import { getDesktopWs } from '../services/vm-bridge';

interface VoiceBridgeConfig {
  provider?: string;
  voice?: string;
  model?: string;
  systemPrompt?: string;
  initialMessage?: string;
  /** When true, skip tool injection (e.g. for diagnostic/preview sessions). */
  disableTools?: boolean;
  /**
   * Client-supplied voice session id. The desktop renderer generates this
   * up-front and asks main to open a per-session bridge WS to /ws with
   * `?voice_session=<id>`. We use it here to wait for that bridge before
   * building voice context (so identity/directive/bio facts can be loaded
   * from the desktop runtime, not the stale Supabase mirror).
   */
  sessionId?: string;
}

export function handleVoiceConnection(ws: WebSocket, _req: IncomingMessage) {
  let session: VoiceSession | null = null;
  let authenticated = false;
  let userId: string | null = null;
  let isClosed = false;
  let voiceSessionId: string | null = null;

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
      if (voiceSessionId) {
        cleanupVoiceBridge(voiceSessionId);
        voiceSessionId = null;
      }

      const config = msg as VoiceBridgeConfig;
      const wantTools = !config.disableTools;

      // Pick a provider. When the caller didn't pin one, prefer a tool-capable
      // provider so the voice agent runs as the orchestrator (delegate, search
      // tools, run workflows, etc.) instead of degrading to a chat-only voice
      // when ElevenLabs happens to be the first configured provider.
      let providerId: string;
      if (config.provider) {
        providerId = config.provider;
      } else if (wantTools) {
        const toolCapable = findToolCapableVoiceProvider();
        providerId = toolCapable?.id || getDefaultProviderId();
      } else {
        providerId = getDefaultProviderId();
      }
      const provider = getVoiceProvider(providerId);

      if (!provider) {
        send(ws, { type: 'error', message: `provider_not_found: ${providerId}` });
        return;
      }

      if (!provider.isConfigured()) {
        send(ws, { type: 'error', message: `provider_not_configured: ${providerId}` });
        return;
      }

      // Decide whether tools are usable on this provider/session.
      const enableVoiceTools = wantTools && supportsVoiceToolCalling(provider);
      if (wantTools && !enableVoiceTools) {
        console.warn(`[voice-bridge] Tools disabled — provider '${providerId}' does not support function calling. Configure GOOGLE_API_KEY (gemini-live), OPENAI_API_KEY (openai-realtime), or XAI_API_KEY (grok-realtime) to enable orchestrator tools in voice mode.`);
      }

      // ── Resolve the desktop bridge WS for this session ──────────────────
      // Preferred path: the renderer generated a sessionId up-front and the
      // desktop main process is opening a per-session bridge WS in parallel.
      // We wait briefly for it to register so knowledge/runtime lookups land
      // on THIS cloud-ai instance instead of relying on the stale Supabase
      // mirror.
      //
      // Fallbacks (in order):
      //   1. The user's main chat WS, if it happens to be on this instance.
      //   2. Supabase signaling (`requestDesktopBridge`) — only useful when
      //      the desktop hasn't already initiated a bridge; this is the
      //      same path telnyx uses.
      //   3. No bridge — buildVoiceContext drops to its Supabase mirror.
      let bridgeWs: WebSocket | undefined;
      if (config.sessionId) {
        const existing = getVoiceBridgeWs(config.sessionId);
        if (existing) {
          bridgeWs = existing;
        } else {
          const awaited = await awaitVoiceBridge(config.sessionId, 6_000).catch(() => null);
          bridgeWs = awaited || undefined;
        }
        if (bridgeWs) {
          console.log('[voice-bridge] Using per-session desktop bridge', { sessionId: config.sessionId });
        } else {
          console.warn('[voice-bridge] Per-session desktop bridge did not register in time', { sessionId: config.sessionId });
        }
      }
      if (!bridgeWs && userId) {
        const main = getDesktopWs(userId);
        if (main) {
          bridgeWs = main;
          console.log('[voice-bridge] Falling back to main chat WS as bridge');
        }
      }

      let voiceContext: Awaited<ReturnType<typeof buildVoiceContext>> | null = null;
      if (userId) {
        try {
          voiceContext = await buildVoiceContext({
            userId,
            direction: 'outbound',
            customPrompt: config.systemPrompt,
            bridgeWs,
            enableTools: enableVoiceTools,
          });
        } catch (err: any) {
          console.warn('[voice-bridge] buildVoiceContext failed, using fallback prompt:', err?.message);
        }
      }

      const effectiveSystemPrompt =
        voiceContext?.systemPrompt ||
        config.systemPrompt ||
        'You are Stuard, a helpful AI assistant. Always respond in English. Keep responses concise and conversational.';
      const effectiveTools = voiceContext?.tools || [];

      try {
        const sessionConfig: VoiceSessionConfig = {
          providerId,
          voiceId: config.voice,
          model: config.model,
          systemPrompt: effectiveSystemPrompt,
          language: 'en',
          initialMessage: config.initialMessage,
          // Browser sends/receives PCM16 at 24kHz
          inputAudioFormat: 'pcm_24000',
          outputAudioFormat: 'pcm_24000',
          tools: effectiveTools,
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
          onFunctionCall: (callId, name, argsJson) => {
            // Surface tool activity to the UI immediately so the user sees
            // what Stuard is doing instead of staring at silent thinking.
            if (!isClosed) {
              send(ws, {
                type: 'tool_call',
                callId,
                name,
                args: safeParseArgs(argsJson),
              });
            }
            handleFunctionCall(callId, name, argsJson, userId || '', voiceSessionId || '', session, ws, () => isClosed)
              .catch(err => {
                console.error('[voice-bridge] Function call error:', err?.message);
                try {
                  session?.sendFunctionResult?.(callId, JSON.stringify({
                    ok: false,
                    error: err?.message || 'Tool execution failed',
                    hint: 'Tell the user you hit an issue, apologise briefly, and either retry or move on.',
                  }));
                  if (!isClosed) {
                    send(ws, {
                      type: 'tool_result',
                      callId,
                      name,
                      ok: false,
                      error: err?.message || 'Tool execution failed',
                    });
                  }
                } catch (sendErr: any) {
                  console.error('[voice-bridge] Failed to deliver function error result:', sendErr?.message);
                }
              });
          },
        };

        session = await provider.createSession(sessionConfig);

        // Prefer the client-supplied sessionId for bridge keying so the
        // per-session bridge that the desktop opened earlier (registered
        // in voice-bridge-manager via the auth handler) lines up with the
        // tool dispatcher. Fall back to the provider's session id when
        // the client didn't pre-generate one.
        voiceSessionId = config.sessionId || session.id;

        // If we already had a bridge WS at context-build time AND the
        // client did not provide its own sessionId, fall back to manually
        // registering it under the provider's session id so tools can
        // reach the desktop runtime.
        if (!config.sessionId && bridgeWs && voiceSessionId) {
          try { registerVoiceBridge(voiceSessionId, bridgeWs); } catch {}
        }

        // Bridge audio from provider back to browser as binary PCM16
        session.onAudio((audioBase64: string) => {
          if (!isClosed && ws.readyState === WebSocket.OPEN) {
            const buf = Buffer.from(audioBase64, 'base64');
            ws.send(buf);
          }
        });

        send(ws, {
          type: 'ready',
          provider: providerId,
          sessionId: voiceSessionId,
          tools: effectiveTools.map(t => t.name),
          toolsEnabled: enableVoiceTools,
          contextLoaded: !!voiceContext,
          bridgeAvailable: !!bridgeWs,
        });
        writeLog('voice_session_started', {
          userId,
          provider: providerId,
          sessionId: voiceSessionId,
          toolCount: effectiveTools.length,
          toolsEnabled: enableVoiceTools,
          bridgeAvailable: !!bridgeWs,
        });
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
    if (voiceSessionId) {
      cleanupVoiceBridge(voiceSessionId);
      voiceSessionId = null;
    }
    writeLog('voice_bridge_disconnected', { userId: userId || 'unauth', reason });
  }
}

// ── Function Call Execution ────────────────────────────────────────────────
// Mirrors the telnyx bridge: run the tool, push the result back into the
// realtime session, and forward a tool_result event to the UI.
async function handleFunctionCall(
  callId: string,
  name: string,
  argsJson: string,
  userId: string,
  voiceSessionId: string,
  session: VoiceSession | null,
  clientWs: WebSocket,
  isClosed: () => boolean,
): Promise<void> {
  let result: any;
  try {
    result = await executeVoiceToolCall({
      name,
      argsJson,
      userId,
      channel: 'telnyx', // browser voice reuses the same tool surface; the
                        // channel only gates SMS, which is fine to allow here.
      voiceSessionId,
    });
  } catch (err: any) {
    result = {
      ok: false,
      error: err?.message || 'Tool crashed',
    };
  }

  if (!session || !session.isActive?.()) return;

  try {
    session.sendFunctionResult?.(callId, truncateVoiceToolResult(result));
  } catch (sendErr: any) {
    console.error('[voice-bridge] Failed to send function result to session:', sendErr?.message);
  }

  if (!isClosed()) {
    send(clientWs, {
      type: 'tool_result',
      callId,
      name,
      ok: result?.ok !== false,
      error: result?.error,
    });
  }
}

function safeParseArgs(argsJson: string): Record<string, any> {
  try { return JSON.parse(argsJson || '{}'); } catch { return {}; }
}

function send(ws: WebSocket, data: any) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch {}
}
