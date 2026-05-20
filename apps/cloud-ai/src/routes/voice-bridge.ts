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
import { verifyToken, checkAccess } from '../supabase';
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
  type VoiceUsageEvent,
} from '../voice';
import {
  executeVoiceToolCall,
  truncateVoiceToolResult,
} from '../voice/voice-runtime-tools';
import { getDesktopWs } from '../services/vm-bridge';
import { LiveUsageBillingTracker } from '../services/live-usage-billing';

interface VoiceBridgeConfig {
  provider?: string;
  voice?: string;
  model?: string;
  systemPrompt?: string;
  initialMessage?: string;
  /** When true, skip tool injection (e.g. for diagnostic/preview sessions). */
  disableTools?: boolean;
  /** Legacy client hint. Ignored for billing until voice BYOK is implemented. */
  modelSource?: 'subscription' | 'api_key' | 'friendly' | string;
  /** Optional conversation id so usage rows attach to the right thread. */
  conversationId?: string;
}

export function handleVoiceConnection(ws: WebSocket, _req: IncomingMessage) {
  let session: VoiceSession | null = null;
  let authenticated = false;
  let userId: string | null = null;
  let isClosed = false;
  let voiceSessionId: string | null = null;
  let billingTracker: LiveUsageBillingTracker | null = null;

  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      send(ws, { type: 'error', message: 'auth_timeout' });
      ws.close();
    }
  }, 10000);

  // Send list of available providers on connect
  const providers = getConfiguredProviders().map(p => ({ id: p.id, name: p.name }));
  send(ws, { type: 'providers', providers, default: getDefaultProviderId() });

  ws.on('message', async (data: Buffer | string, isBinary?: boolean) => {
    if (isClosed) return;

    // The `ws` library emits Buffer for both binary and text frames, so
    // `Buffer.isBuffer(data)` alone can't tell them apart — gate on the
    // `isBinary` flag instead. Without this, JSON control frames (video_frame,
    // text, interrupt) sent after the session is created would get misrouted
    // into sendAudio.
    if (isBinary && authenticated && session) {
      // Convert raw PCM16 buffer to base64 for the provider
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
      session.sendAudio(buf.toString('base64'));
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
      voiceSessionId = null;
      billingTracker = null;

      const config = msg as VoiceBridgeConfig;
      const wantTools = !config.disableTools;

      // Preflight credit gate. Reject before opening the upstream WebSocket
      // so a user with no credits never spends provider tokens. checkAccess
      // returns { allowed: true } in dev mode and for unlimited plans.
      if (userId) {
        try {
          const access = await checkAccess(userId);
          if (!access.allowed) {
            send(ws, {
              type: 'error',
              message: access.reason || 'credit_limit_exceeded',
              data: { plan: access.plan, limit: access.limit, used: access.used },
            });
            return;
          }
        } catch (err: any) {
          console.warn('[voice-bridge] checkAccess failed, denying session:', err?.message);
          send(ws, { type: 'error', message: 'credit_check_failed' });
          return;
        }
      }

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

      // ── Resolve the desktop bridge WS ────────────────────────────────────
      // The desktop app keeps a persistent /ws?client=desktop connection open
      // (cloud-webhooks main WS). That same WS is the tool/context bridge
      // for both text chat and voice — no per-session bridge needed. If the
      // desktop is offline we still proceed, but voice will fall back to the
      // Supabase mirror for context and tools that need local state will
      // fail with `bridge_closed`.
      const bridgeWs: WebSocket | undefined = userId ? getDesktopWs(userId) : undefined;
      if (bridgeWs) {
        console.log('[voice-bridge] Using persistent desktop WS as bridge', { userId });
      } else {
        console.warn('[voice-bridge] No persistent desktop WS — voice will run with cloud-only context', { userId });
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

      // Voice realtime currently uses Stuard-owned provider keys. Do not trust
      // client modelSource claims until voice BYOK/subscription resolution exists.
      const billingExcluded = false;

      // Pick the model id we'll log against. Providers stamp a fully qualified
      // id (e.g. `openai/gpt-4o-realtime-preview`) on each usage event, but
      // we need a placeholder for the tracker constructor — it's only used
      // when the per-event `costUsd` is missing, which shouldn't happen.
      const placeholderModel = providerId === 'openai-realtime'
        ? (config.model || 'gpt-4o-realtime-preview')
        : providerId === 'gemini-live'
          ? (config.model || 'gemini-3.1-flash-live-preview')
          : providerId === 'grok-realtime'
            ? (config.model || 'grok-3')
            : providerId === 'elevenlabs'
              ? (config.model || 'eleven_turbo_v2_5')
              : (config.model || providerId);

      billingTracker = userId ? new LiveUsageBillingTracker({
        userId,
        conversationId: typeof config.conversationId === 'string' ? config.conversationId : null,
        model: placeholderModel,
        sourceRef: `voice:${providerId}`,
        sourceType: 'voice',
        sourceLabel: `Voice (${providerId})`,
        billingExcluded,
      }) : null;

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
          onUsage: (event: VoiceUsageEvent) => {
            if (!billingTracker) return;
            // Fire-and-forget: a billing error must not stall the voice turn.
            // settleIncrement logs its own errors via writeLog('live_usage_billing_error').
            void billingTracker.settleIncrement(
              {
                promptTokens: event.inputTokens,
                completionTokens: event.outputTokens,
                totalTokens: event.inputTokens + event.outputTokens,
                cachedPromptTokens: event.cachedInputTokens || 0,
                reasoningTokens: event.reasoningTokens || 0,
                costUsd: event.costUsd,
                // Carry the provider-stamped model so the log row reflects the
                // actual model, not the tracker's placeholder.
                model: event.model,
              },
              { trigger: 'voice_turn' },
            ).catch(() => { /* swallowed — logged inside the tracker */ });
            if (!isClosed) {
              send(ws, {
                type: 'usage',
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                costUsd: event.costUsd,
              });
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
        voiceSessionId = session.id;

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

    // Video / screen frame from client. Currently only Gemini Live consumes
    // these; other providers silently ignore. Frame is expected to be a
    // base64-encoded JPEG (or PNG). Caller is responsible for keeping cadence
    // ≤1 FPS per Gemini's guidance.
    if (msg.type === 'video_frame') {
      if (!session) return;
      if (!session.sendImage) {
        console.warn(`[voice-bridge] video_frame dropped — provider '${session.providerId}' does not implement sendImage. Use gemini-live for vision.`);
        return;
      }
      const data = typeof msg.data === 'string' ? msg.data : '';
      const mimeType = typeof msg.mimeType === 'string' ? msg.mimeType : 'image/jpeg';
      if (data) session.sendImage(data, mimeType);
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
    // Close the upstream session first — for ElevenLabs this triggers the
    // close-time duration usage event, which routes through onUsage and is
    // settled by the tracker before we drop the reference below.
    if (session) {
      try { session.close(reason); } catch {}
      session = null;
    }
    const totals = billingTracker?.getCumulativeTotals();
    billingTracker = null;
    voiceSessionId = null;
    writeLog('voice_bridge_disconnected', {
      userId: userId || 'unauth',
      reason,
      totalCredits: totals?.credits || 0,
      totalCostUsd: totals?.costUsd || 0,
      totalTokens: totals?.totalTokens || 0,
    });
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
