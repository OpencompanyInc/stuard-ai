/**
 * Live Session Bus
 *
 * Decouples the agent → voice-pill trigger. When the cloud orchestrator calls
 * the `start_live_session` tool, it's dispatched to the renderer as a
 * `tool_request` (same channel chat_ui uses). `useAgent` handles that request by
 * calling `requestLiveSession(...)`, which is fulfilled by the app-level voice
 * orchestrator (`useAppVoiceMode`) that registers a handler here. This avoids
 * threading a voice-start callback through the whole component tree.
 */

export interface LiveSessionConfig {
  /** Stable id for this voice session — used to route end triggers to the right workflow. */
  sessionId?: string;
  /** Workflow that started the session (when started from a workflow step). */
  workflowId?: string;
  /** Knowledge pack ids to attach to the session (scoped query tool). */
  knowledgePackIds?: string[];
  /** Optional id+title pairs so the live prompt can name the attached packs. */
  knowledgePacks?: Array<{ id: string; title?: string }>;
  /** Extra system-prompt guidance (persona/instructions for the session). */
  systemPrompt?: string;
  /** First line the assistant should speak. */
  initialMessage?: string;
  /** Override the voice provider (defaults to server default). */
  provider?: string;
}

export interface LiveSessionResult {
  ok: boolean;
  sessionId?: string;
  workflowId?: string;
  error?: string;
}

type Handler = (cfg: LiveSessionConfig) => Promise<LiveSessionResult> | LiveSessionResult;

let _handler: Handler | null = null;

/** Register the app-level voice-start handler. Returns an unsubscribe fn. */
export function registerLiveSessionHandler(handler: Handler): () => void {
  _handler = handler;
  return () => {
    if (_handler === handler) _handler = null;
  };
}

/** Ask the app to open a live voice session with the given config. */
export async function requestLiveSession(cfg: LiveSessionConfig): Promise<LiveSessionResult> {
  if (!_handler) return { ok: false, error: 'voice_unavailable' };
  try {
    return await _handler(cfg);
  } catch (e: any) {
    return { ok: false, error: e?.message || 'voice_start_failed' };
  }
}

// ── Live-session feedback channel ────────────────────────────────────────────
// When a structured live session ends (the model called `end_live_session`),
// the cloud sends a `session_feedback` message; `useVoiceMode` publishes it
// here and `useAgent` consumes it to inject a silent orchestrator turn so the
// chat assistant relays the wrap-up and saves what matters.

export interface LiveSessionFeedback {
  summary: string;
  outcome?: 'completed' | 'partial' | 'stopped_early';
  highlights?: string[];
  followUps?: string[];
}

type FeedbackHandler = (feedback: LiveSessionFeedback) => void;

let _feedbackHandler: FeedbackHandler | null = null;

/** Register the chat-side consumer of live-session feedback. Returns unsubscribe. */
export function registerLiveFeedbackHandler(handler: FeedbackHandler): () => void {
  _feedbackHandler = handler;
  return () => {
    if (_feedbackHandler === handler) _feedbackHandler = null;
  };
}

/** Publish a live session's wrap-up so the chat assistant can relay it. */
export function publishLiveSessionFeedback(feedback: LiveSessionFeedback): void {
  if (!_feedbackHandler) return;
  try {
    _feedbackHandler(feedback);
  } catch { /* a consumer error must not break the voice teardown */ }
}
