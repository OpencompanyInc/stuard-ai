import { useSyncExternalStore } from 'react';
import type { AgentTodoItem, AgentTodoListProps, AgentTodoStatus } from '../../../genui/AgentTodoList';

export type { AgentTodoStatus };

/**
 * Shared, module-level store for the agent's live to-do plan.
 *
 * Why this exists:
 *  - The to-do panel unmounts whenever the sidebar switches tabs (terminal /
 *    projects). When the snapshot lived in the panel's local state, switching
 *    away and back wiped the plan until the next agent update arrived — the
 *    "buggy switching between tabs" report.
 *  - Three separate components each kept their own `agent-todo-update` listener
 *    + 15s activity timer. That duplication drifted and made the "Active"
 *    badge / auto-switch behave inconsistently.
 *
 * This singleton owns one listener, one activity timer, and the latest
 * snapshot. Components read it via `useAgentTodos()` / `useAgentTodoActivity()`
 * so the plan survives remounts and the activity signal is identical
 * everywhere. It also relays updates to the detached sidebar window so a
 * popped-out To-Do tab stays in sync.
 */

export interface AgentTodoSnapshot {
  items: AgentTodoItem[];
  title?: string;
  status?: AgentTodoStatus | null;
  progress?: AgentTodoListProps['progress'];
  /** Wall-clock time of the most recent update — used to fade the activity dot. */
  timestamp: number;
}

const ACTIVITY_WINDOW_MS = 15_000;
// After the agent's turn ends we wait a beat (lets the model's own `finish`/
// `clear` land first), then — only if the plan actually finished — collapse it
// so a completed checklist doesn't linger forever. A still-unfinished plan
// (e.g. the agent paused to ask a question) is left untouched.
const SETTLE_GRACE_MS = 1_200;
const DONE_HOLD_MS = 3_500;

let snapshot: AgentTodoSnapshot | null = null;
let active = false;
let activeTimer: ReturnType<typeof setTimeout> | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let collapseTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function clearFinalizeTimers(): void {
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
}

function normalizeStatus(raw: any): AgentTodoStatus | null {
  if (!raw || typeof raw.label !== 'string' || !raw.label.trim()) return null;
  const state = ['working', 'done', 'blocked', 'idle'].includes(raw.state) ? raw.state : 'working';
  return {
    label: raw.label.trim(),
    detail: typeof raw.detail === 'string' && raw.detail.trim() ? raw.detail.trim() : null,
    state,
  };
}

function markActive(): void {
  active = true;
  if (activeTimer) clearTimeout(activeTimer);
  activeTimer = setTimeout(() => {
    active = false;
    emit();
  }, ACTIVITY_WINDOW_MS);
}

/** True when a streamed GenUI `agent_todo` block carries plan and/or status data. */
export function isRoutableAgentTodoDetail(detail: any): boolean {
  if (!detail) return false;
  if (Array.isArray(detail.items) && detail.items.length > 0) return true;
  return !!normalizeStatus(detail.status);
}

/** Route a GenUI `agent_todo` payload into the shared store (chat + compact mode). */
export function routeAgentTodoUpdate(detail: any): void {
  if (!isRoutableAgentTodoDetail(detail)) return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('agent-todo-update', {
    detail: {
      ...detail,
      items: Array.isArray(detail.items) ? detail.items : [],
    },
  }));
}

/** Coerce a raw `agent-todo-update` detail into a normalized snapshot. */
function ingest(detail: any, opts: { forward: boolean }): void {
  if (!detail) return;

  const status = normalizeStatus(detail.status);
  const incomingItems = Array.isArray(detail.items) ? (detail.items as AgentTodoItem[]) : null;
  const items = incomingItems !== null ? incomingItems : (snapshot?.items ?? []);
  if (items.length === 0 && !status) return;

  // A fresh update means the agent is working again — cancel any pending
  // end-of-turn collapse so we don't wipe a plan that's still in play.
  clearFinalizeTimers();

  snapshot = {
    items,
    title: typeof detail.title === 'string' ? detail.title : snapshot?.title,
    status,
    progress: detail.progress ?? snapshot?.progress,
    timestamp: Date.now(),
  };
  markActive();
  emit();

  // Relay to the detached sidebar window (no-op in that window itself).
  if (opts.forward) {
    try {
      (window as any).desktopAPI?.broadcastAgentTodo?.(detail);
    } catch {
      // best-effort; the detached window is optional
    }
  }
}

function ensureInitialized(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Local updates from the chat stream (MessageBubble routes agent_todo here).
  window.addEventListener('agent-todo-update', (e: Event) => {
    ingest((e as CustomEvent).detail, { forward: true });
  });

  // Updates relayed from the main window into a detached sidebar window.
  try {
    (window as any).desktopAPI?.onSidebarTodoUpdate?.((detail: any) => {
      ingest(detail, { forward: false });
    });
  } catch {
    // detached-window bridge is optional
  }
}

export function subscribe(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTodoSnapshot(): AgentTodoSnapshot | null {
  ensureInitialized();
  return snapshot;
}

export function getTodoActivity(): boolean {
  ensureInitialized();
  return active;
}

/** Clear the current plan (e.g. when starting a fresh conversation). */
export function clearTodoSnapshot(): void {
  snapshot = null;
  active = false;
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  clearFinalizeTimers();
  emit();
}

/** True when the plan has nothing left to do — every step is terminal. */
function isPlanFinished(snap: AgentTodoSnapshot): boolean {
  if (snap.status?.state === 'done') return true;
  const items = snap.items;
  if (items.length === 0) return !snap.status || snap.status.state === 'idle';
  return items.every((i) => i.status === 'completed' || i.status === 'failed');
}

/**
 * The agent started working again — cancel any pending end-of-turn collapse.
 * Call this when the AI re-enters an active phase.
 */
export function notifyTurnActive(): void {
  clearFinalizeTimers();
}

/**
 * The agent's turn ended. This is the safety net behind the model's own
 * `finish` call: if the plan is genuinely done, collapse it shortly so a
 * completed checklist never lingers looking "stuck". An unfinished plan (the
 * agent paused to ask the user something) is deliberately left in place — the
 * activity dot fades on its own, and the next turn picks it back up.
 */
export function notifyTurnEnded(): void {
  clearFinalizeTimers();
  if (!snapshot) return;

  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (!snapshot) return;
    if (!isPlanFinished(snapshot)) return; // paused mid-task — keep it visible
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      clearTodoSnapshot();
    }, DONE_HOLD_MS);
  }, SETTLE_GRACE_MS);
}

/** Latest live status headline, or null. Survives remounts like the plan. */
export function getTodoStatus(): AgentTodoStatus | null {
  ensureInitialized();
  return snapshot?.status ?? null;
}

/** Latest agent plan, surviving tab switches and panel remounts. */
export function useAgentTodos(): AgentTodoSnapshot | null {
  return useSyncExternalStore(subscribe, getTodoSnapshot, () => null);
}

/** True while the agent has touched the plan within the activity window. */
export function useAgentTodoActivity(): boolean {
  return useSyncExternalStore(subscribe, getTodoActivity, () => false);
}

/** Latest live status headline ("what's happening now"), surviving remounts. */
export function useAgentTodoStatus(): AgentTodoStatus | null {
  return useSyncExternalStore(subscribe, getTodoStatus, () => null);
}
