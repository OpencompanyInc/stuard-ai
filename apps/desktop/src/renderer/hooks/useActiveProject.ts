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

  const load = useCallback(async () => {
    if (!conversationId) {
      toolProjectRef.current = null;
      setProject(null);
      return;
    }
    setLoading(true);
    try {
      const projectId = await fetchConversationProjectId(conversationId);
      if (!projectId) {
        if (toolProjectRef.current?.conversationId === conversationId) {
          setProject(toolProjectRef.current.project);
          return;
        }
        setProject(null);
        return;
      }
      const fetched = await getProject(projectId);
      if (fetched) {
        toolProjectRef.current = { conversationId, project: fetched };
      }
      setProject(fetched);
    } finally {
      setLoading(false);
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
        toolProjectRef.current = null;
        setProject(null);
        return;
      }

      if (tool === 'enter_project_mode' || (tool === 'conversation_set_project' && projectId)) {
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
