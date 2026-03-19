/**
 * Telnyx ↔ Voice Provider WebSocket Bridge
 *
 * Provider-agnostic telephony bridge that connects Telnyx media streaming
 * to any registered voice provider (ElevenLabs, OpenAI Realtime, etc.).
 *
 * Flow:
 *   1. Telnyx call webhook starts media streaming to /ws/telnyx-bridge
 *   2. Bridge parses query params to determine provider + config
 *   3. Loads user context (memory, profile) via voice-context builder
 *   4. Creates a voice session with tools + context via the provider registry
 *   5. Bridges audio bidirectionally: Telnyx ↔ Voice Provider
 *   6. Handles function calls from the AI (SIS, web search, memory, SMS)
 *   7. Captures transcripts and stores call metadata
 *
 * Audio: Telnyx sends/receives PCMU (µ-law 8kHz), which all providers
 * support natively (ElevenLabs=ulaw_8000, OpenAI=g711_ulaw).
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { TELNYX_API_KEY, TELNYX_FROM_NUMBER } from '../../utils/config';
import {
  getVoiceProvider,
  getDefaultProviderId,
  registerActiveCall,
  removeActiveCall,
  buildVoiceContext,
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
    userId: params.userId ? params.userId.slice(0, 8) + '…' : 'none',
  });

  // ── Load voice context (user memory, tools, system prompt) ──────────────
  // This runs in parallel with Telnyx stream setup for minimal latency.
  let voiceContext: Awaited<ReturnType<typeof buildVoiceContext>> | null = null;

  if (params.userId) {
    try {
      voiceContext = await buildVoiceContext({
        userId: params.userId,
        direction: params.direction || 'outbound',
        callerNumber: params.callerNumber,
        customPrompt: params.systemPrompt,
      });
      console.log('[telnyx-bridge] Voice context loaded', {
        callControlId,
        userName: voiceContext.userName,
        toolCount: voiceContext.tools.length,
        promptLen: voiceContext.systemPrompt.length,
      });
    } catch (e: any) {
      console.warn('[telnyx-bridge] Failed to load voice context, proceeding without:', e?.message);
    }
  }

  // Use voice context if available, otherwise fall back to params
  const effectiveSystemPrompt = voiceContext?.systemPrompt || params.systemPrompt || '';
  const effectiveTools = voiceContext?.tools || [];

  const transcripts: Array<{ role: string; text: string; timestamp: number }> = [];

  const sessionConfig: VoiceSessionConfig = {
    providerId,
    agentId: params.agentId,
    voiceId: params.voiceId,
    model: params.model,
    initialMessage: params.initialMessage,
    systemPrompt: effectiveSystemPrompt,
    language: params.metadata?.language,
    metadata: params.metadata,
    inputAudioFormat: 'ulaw_8000',
    outputAudioFormat: 'ulaw_8000',
    tools: effectiveTools,
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
    onFunctionCall: (callId, name, argsJson) => {
      // Execute the tool call asynchronously, then send result back
      handleFunctionCall(callId, name, argsJson, params.userId || '', session)
        .catch(err => {
          console.error('[telnyx-bridge] Function call error:', err?.message);
          // Send error result so the AI knows it failed
          session?.sendFunctionResult?.(callId, JSON.stringify({ error: err?.message || 'Tool execution failed' }));
        });
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

// ── Function Call Execution ─────────────────────────────────────────────────
// Handles tool calls from the voice AI during a live call.

async function handleFunctionCall(
  callId: string,
  name: string,
  argsJson: string,
  userId: string,
  session: VoiceSession | null,
): Promise<void> {
  const startTime = Date.now();
  let args: Record<string, any> = {};
  try {
    args = JSON.parse(argsJson);
  } catch {
    args = {};
  }

  console.log('[telnyx-bridge] Executing function call', { callId, name, userId: userId.slice(0, 8) });

  let result: any;

  switch (name) {
    case 'sis_search_tools': {
      const { sis_search_tools } = await import('../../tools/sis-runtime-tools');
      result = await sis_search_tools.execute!(
        { query: args.query || '', category: args.category, limit: args.limit || 5 },
        {} as any,
      );
      break;
    }

    case 'sis_execute_tool': {
      const { sis_execute_tool } = await import('../../tools/sis-runtime-tools');
      result = await sis_execute_tool.execute!(
        { tool_name: args.tool_name || '', args: args.args || {} },
        {} as any,
      );
      break;
    }

    case 'web_search': {
      const { web_search } = await import('../../tools/perplexity-tools');
      result = await web_search.execute!(
        { query: args.query || '', max_results: Math.min(args.max_results || 3, 5) },
        {} as any,
      );
      break;
    }

    case 'memory_search': {
      result = await executeMemorySearch(userId, args.query || '', args.limit || 3);
      break;
    }

    case 'send_sms': {
      result = await executeSendSms(userId, args.message || '');
      break;
    }

    default: {
      result = { error: `Unknown voice tool: ${name}. Use sis_search_tools to find available tools.` };
    }
  }

  const elapsed = Date.now() - startTime;
  console.log('[telnyx-bridge] Function call completed', { callId, name, elapsed: `${elapsed}ms` });

  // Truncate result to avoid overwhelming the model
  const resultStr = JSON.stringify(result);
  const truncated = resultStr.length > 2000 ? resultStr.slice(0, 2000) + '...(truncated)' : resultStr;

  session?.sendFunctionResult?.(callId, truncated);
}

/**
 * Cloud-native memory search via Supabase.
 * Searches recent conversations directly without requiring a desktop client bridge.
 */
async function executeMemorySearch(userId: string, query: string, limit: number): Promise<any> {
  try {
    const { getSupabaseService, getConversationMessages } = await import('../../supabase');
    const supabase = getSupabaseService();
    if (!supabase) return { ok: false, error: 'Memory service unavailable' };

    const queryLower = query.toLowerCase();
    const safeLimit = Math.max(1, Math.min(limit, 5));

    // Search conversations by title (text search — fast, no embedding needed)
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, title, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!convs || convs.length === 0) {
      return { ok: true, results: [], message: 'No past conversations found.' };
    }

    // Score conversations by title relevance
    const scored = convs
      .map(c => {
        const title = (c.title || '').toLowerCase();
        let score = 0;
        const words = queryLower.split(/\s+/);
        for (const w of words) {
          if (w.length > 2 && title.includes(w)) score += 1;
        }
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, safeLimit);

    // Load recent messages from top matches
    const results = [];
    for (const conv of scored) {
      const msgs = await getConversationMessages(userId, conv.id, 3);
      results.push({
        title: conv.title || 'Untitled',
        date: new Date(conv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        messages: msgs.map(m => ({
          role: m.role,
          content: String(m.content).slice(0, 150),
        })),
      });
    }

    return { ok: true, results };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Memory search failed' };
  }
}

/**
 * Send an SMS to the user during a voice call.
 */
async function executeSendSms(userId: string, message: string): Promise<any> {
  try {
    const { getExternalAccount } = await import('../../supabase');
    const acc = await getExternalAccount(userId, 'telnyx');
    if (!acc?.meta?.verified || !acc.meta.phone) {
      return { ok: false, error: 'No verified phone number' };
    }

    if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) {
      return { ok: false, error: 'SMS not configured' };
    }

    const { TELNYX_MESSAGING_PROFILE_ID } = await import('../../utils/config');
    const body: any = {
      from: TELNYX_FROM_NUMBER,
      to: acc.meta.phone,
      text: String(message).slice(0, 1600),
    };
    if (TELNYX_MESSAGING_PROFILE_ID) {
      body.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
    }

    const res = await fetch(`${TELNYX_API}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return { ok: false, error: `SMS failed (${res.status})` };
    }

    return { ok: true, message: 'SMS sent successfully' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to send SMS' };
  }
}

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
