/**
 * useActiveProject — resolve the project (if any) stamped on the current
 * conversation, so the chat surface can lock onto it (chip + accent border +
 * sticky header).
 *
 * Source of truth lives in the Python agent's SQLite — we go through the
 * `tools:exec` IPC bridge with conversation_get → project_get. Refreshes:
 *   • when conversationId changes
 *   • when isStreaming transitions true → false (the AI may have just
 *     called enter_project_mode / exit_project_mode mid-turn)
 *   • when window dispatches a 'project-mode-changed' event (manual)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from './useProjects';
import { getProject } from './useProjects';

async function fetchConversationProjectId(conversationId: string): Promise<string | null> {
  try {
    const api = (window as any).desktopAPI;
    if (!api?.execTool) return null;
    const result = await api.execTool('conversation_get', { conversation_id: conversationId });
    if (!result?.ok) return null;
    return result.conversation?.project_id ?? null;
  } catch {
    return null;
  }
}

export function useActiveProject(
  conversationId: string | null,
  isStreaming: boolean,
): {
  project: Project | null;
  loading: boolean;
  refresh: () => void;
  clear: () => Promise<void>;
} {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const prevStreamingRef = useRef(isStreaming);
  const toolProjectRef = useRef<{ conversationId: string; project: Project } | null>(null);
  // Monotonic token so a slow load for a previous tab/conversation can't
  // clobber the state after the user has already switched tabs. Without this,
  // switching A → B → A could leave tab A showing "no project" because B's
  // (empty) result resolved last.
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!conversationId) {
      // A fresh tab has no conversation yet — show no project, but keep
      // toolProjectRef intact: it belongs to another conversation and is
      // needed when the user switches back to that tab.
      setProject(null);
      return;
    }
    setLoading(true);
    try {
      const projectId = await fetchConversationProjectId(conversationId);
      if (seq !== loadSeqRef.current) return; // stale — a newer load started
      if (!projectId) {
        if (toolProjectRef.current?.conversationId === conversationId) {
          setProject(toolProjectRef.current.project);
          return;
        }
        setProject(null);
        return;
      }
      const fetched = await getProject(projectId);
      if (seq !== loadSeqRef.current) return;
      if (fetched) {
        toolProjectRef.current = { conversationId, project: fetched };
      }
      setProject(fetched);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [conversationId]);

  // Refresh on conversation change.
  useEffect(() => {
    void load();
  }, [load]);

  // Refresh when a stream ends — the AI may have entered or exited project
  // mode during the turn.
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      void load();
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, load]);

  // Manual / external refresh hook. Project-mode tool calls include enough
  // detail for an optimistic UI update, so the chat chrome flips immediately
  // instead of waiting for a conversation_get/project_get round trip.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const eventConversationId = detail.conversationId ? String(detail.conversationId) : '';
      if (eventConversationId && eventConversationId !== conversationId) return;

      const tool = String(detail.tool || '');
      const status = String(detail.status || '');
      if (status && status !== 'completed') return;
      const projectId = detail.projectId == null ? null : String(detail.projectId);

      if (tool === 'exit_project_mode' || (tool === 'conversation_set_project' && !projectId)) {
        // Only hard-clear when the event provably targets THIS conversation.
        // Tool events can originate from another tab's stream; if the
        // conversation id is missing we re-fetch instead of clearing, so a
        // background tab exiting project mode can't strip the active tab.
        if (eventConversationId && eventConversationId === conversationId) {
          toolProjectRef.current = null;
          setProject(null);
        } else {
          void load();
        }
        return;
      }

      if (tool === 'enter_project_mode' || (tool === 'conversation_set_project' && projectId)) {
        // Optimistic apply only when the event provably targets this
        // conversation — otherwise re-fetch so a background tab entering a
        // project doesn't get painted onto the active tab.
        if (!eventConversationId || eventConversationId !== conversationId) {
          void load();
          return;
        }
        if (detail.project?.id) {
          const nextProject = detail.project as Project;
          if (conversationId) {
            toolProjectRef.current = { conversationId, project: nextProject };
          }
          setProject(nextProject);
          return;
        }
        if (projectId) {
          void getProject(projectId).then((fetched) => {
            if (fetched) {
              if (conversationId) {
                toolProjectRef.current = { conversationId, project: fetched };
              }
              setProject(fetched);
            }
          });
          return;
        }
      }

      void load();
    };
    window.addEventListener('project-mode-changed', handler);
    return () => window.removeEventListener('project-mode-changed', handler);
  }, [conversationId, load]);

  const clear = useCallback(async () => {
    if (!conversationId) return;
    try {
      const api = (window as any).desktopAPI;
      await api?.execTool?.('conversation_set_project', {
        conversation_id: conversationId,
        project_id: null,
      });
      toolProjectRef.current = null;
      setProject(null);
      window.dispatchEvent(new CustomEvent('project-mode-changed'));
    } catch { /* ignore */ }
  }, [conversationId]);

  return { project, loading, refresh: load, clear };
}
