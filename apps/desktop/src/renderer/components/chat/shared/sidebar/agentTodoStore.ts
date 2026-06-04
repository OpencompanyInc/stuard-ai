import { useSyncExternalStore } from 'react';
import type { AgentTodoItem, AgentTodoListProps } from '../../../genui/AgentTodoList';

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
  progress?: AgentTodoListProps['progress'];
  /** Wall-clock time of the most recent update — used to fade the activity dot. */
  timestamp: number;
}

const ACTIVITY_WINDOW_MS = 15_000;

let snapshot: AgentTodoSnapshot | null = null;
let active = false;
let activeTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function markActive(): void {
  active = true;
  if (activeTimer) clearTimeout(activeTimer);
  activeTimer = setTimeout(() => {
    active = false;
    emit();
  }, ACTIVITY_WINDOW_MS);
}

/** Coerce a raw `agent-todo-update` detail into a normalized snapshot. */
function ingest(detail: any, opts: { forward: boolean }): void {
  if (!detail || !Array.isArray(detail.items)) return;

  snapshot = {
    items: detail.items as AgentTodoItem[],
    title: typeof detail.title === 'string' ? detail.title : undefined,
    progress: detail.progress,
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
  emit();
}

/** Latest agent plan, surviving tab switches and panel remounts. */
export function useAgentTodos(): AgentTodoSnapshot | null {
  return useSyncExternalStore(subscribe, getTodoSnapshot, () => null);
}

/** True while the agent has touched the plan within the activity window. */
export function useAgentTodoActivity(): boolean {
  return useSyncExternalStore(subscribe, getTodoActivity, () => false);
}
