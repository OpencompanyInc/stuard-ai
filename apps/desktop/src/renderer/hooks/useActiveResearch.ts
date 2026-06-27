/**
 * useActiveResearch — track whether Research Mode is active for the current
 * conversation, plus live counters and the delivered report.
 *
 * Unlike Project Mode (whose truth lives in the local SQLite), research state
 * lives cloud-side keyed by conversationId, so the renderer learns about it
 * exclusively from 'research-mode-changed' CustomEvents dispatched by
 * useAgent.ts when research_* tool events complete. State is kept in a
 * module-level map so it survives tab switches; it resets on app restart
 * (the next research tool call re-lights it).
 */
import { useCallback, useEffect, useState } from 'react';

export interface ResearchReport {
  title: string;
  markdown: string;
  deliveredAt: number;
}

export interface ResearchUiState {
  active: boolean;
  brief?: string;
  sources: number;
  notes: number;
  report?: ResearchReport | null;
  /** Bumped on every new research_report so the UI can auto-open the viewer. */
  reportNonce: number;
  /** Local-only: user collapsed the bar for this conversation. */
  hidden?: boolean;
}

const stateByConversation = new Map<string, ResearchUiState>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => { try { fn(); } catch { } });
}

function ensureState(conversationId: string): ResearchUiState {
  let state = stateByConversation.get(conversationId);
  if (!state) {
    state = { active: false, sources: 0, notes: 0, report: null, reportNonce: 0 };
    stateByConversation.set(conversationId, state);
  }
  return state;
}

function handleResearchEvent(event: Event) {
  const detail = (event as CustomEvent)?.detail || {};
  const conversationId = String(detail.conversationId || '').trim();
  const tool = String(detail.tool || '');
  if (!conversationId || !tool) return;

  const state = ensureState(conversationId);

  if (tool === 'exit_research_mode') {
    stateByConversation.set(conversationId, {
      active: false, sources: 0, notes: 0, report: null, reportNonce: 0,
    });
    notify();
    return;
  }

  // Any successful research_* tool implies an active session — covers app
  // restarts where the enter event was missed but the cloud session lives on.
  state.active = true;
  state.hidden = false;
  if (typeof detail.brief === 'string' && detail.brief.trim()) {
    state.brief = detail.brief.trim();
  }
  if (typeof detail.totalSources === 'number') state.sources = detail.totalSources;
  if (typeof detail.totalNotes === 'number') state.notes = detail.totalNotes;
  if (detail.report?.markdown) {
    state.report = {
      title: String(detail.report.title || 'Research report'),
      markdown: String(detail.report.markdown),
      deliveredAt: Date.now(),
    };
    state.reportNonce += 1;
  }
  notify();
}

let globalListenerAttached = false;
function ensureGlobalListener() {
  if (globalListenerAttached) return;
  globalListenerAttached = true;
  window.addEventListener('research-mode-changed', handleResearchEvent);
}

export function useActiveResearch(conversationId: string | null | undefined): {
  research: ResearchUiState | null;
  dismiss: () => void;
} {
  const [, setVersion] = useState(0);

  useEffect(() => {
    ensureGlobalListener();
    const rerender = () => setVersion((v) => v + 1);
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  }, []);

  const dismiss = useCallback(() => {
    if (!conversationId) return;
    const state = stateByConversation.get(conversationId);
    if (state) {
      state.hidden = true;
      notify();
    }
  }, [conversationId]);

  const state = conversationId ? stateByConversation.get(conversationId) : undefined;
  return {
    research: state && state.active ? state : null,
    dismiss,
  };
}
