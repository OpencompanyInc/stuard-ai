/**
 * useProjects — renderer-side facade over the Python agent's project/journal/memory
 * dispatchers. All calls go through `desktopAPI.execTool` which routes to
 * apps/agent/app/tools/dispatch.py.
 *
 * No new IPC channels are needed: the dispatch surface already exposes
 * project_get / project_list / project_create / project_update / project_delete,
 * memory_create / memory_list / memory_search / memory_delete,
 * journal_add / journal_list / journal_delete, and conversation_set_project.
 */
import { useCallback, useEffect, useState } from 'react';

export type ProjectStatus = 'active' | 'paused' | 'archived';

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  goals?: string | null;
  instructions?: string | null;
  status: ProjectStatus;
  tags: string[];
  pinned_paths: string[];
  digest?: string | null;
  digest_updated_at?: string | null;
  icon: string;
  color: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export type JournalEntryType =
  | 'decision'
  | 'finding'
  | 'blocker'
  | 'edit'
  | 'chat_summary'
  | 'task'
  | 'milestone'
  | 'note'
  | 'question'
  | 'hypothesis';

export interface JournalEntry {
  id: string;
  project_id: string;
  ts: string;
  type: JournalEntryType;
  title: string;
  body?: string | null;
  source?: string;
  source_ref?: Record<string, any> | null;
  created_at: string;
}

export type MemoryType = 'note' | 'fact' | 'snippet' | 'link' | 'file' | 'image';

export interface ProjectMemory {
  id: string;
  type: MemoryType;
  title?: string | null;
  content: string;
  metadata?: Record<string, any> | null;
  url?: string | null;
  project_ids: string[];
  source?: string;
  added_by?: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

interface ExecResult<T> {
  ok: boolean;
  error?: string;
  [key: string]: any;
}

async function exec<T = any>(tool: string, args: any = {}): Promise<ExecResult<T>> {
  try {
    const api = (window as any).desktopAPI;
    if (!api?.execTool) return { ok: false, error: 'desktopAPI.execTool unavailable' };
    return (await api.execTool(tool, args)) as ExecResult<T>;
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export function useProjects(includeArchived = false) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await exec('project_list', { include_archived: includeArchived });
    if (result.ok) {
      setProjects((result.projects as Project[]) || []);
    } else {
      setError(result.error || 'failed to load projects');
    }
    setLoading(false);
  }, [includeArchived]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { projects, loading, error, reload };
}

export async function getProject(projectId: string): Promise<Project | null> {
  const result = await exec('project_get', { project_id: projectId });
  return result.ok ? ((result.project as Project) ?? null) : null;
}

export async function listJournal(projectId: string, limit = 50): Promise<JournalEntry[]> {
  const result = await exec('journal_list', { project_id: projectId, limit });
  return result.ok ? ((result.entries as JournalEntry[]) ?? []) : [];
}

export async function listMemories(projectId: string, limit = 100): Promise<ProjectMemory[]> {
  const result = await exec('memory_list', { project_id: projectId, limit });
  return result.ok ? ((result.memories as ProjectMemory[]) ?? []) : [];
}

export async function createProject(input: {
  name: string;
  description?: string;
  goals?: string;
  instructions?: string;
  status?: ProjectStatus;
  icon?: string;
  color?: string;
}): Promise<Project | null> {
  const result = await exec('project_create', input);
  return result.ok ? ((result.project as Project) ?? null) : null;
}

export async function updateProject(
  projectId: string,
  patch: Partial<Project>,
): Promise<Project | null> {
  const result = await exec('project_update', { project_id: projectId, ...patch });
  return result.ok ? ((result.project as Project) ?? null) : null;
}

export async function addProjectContextPath(
  projectId: string,
  path: string,
): Promise<{ project: Project | null; indexed: boolean; error?: string }> {
  const result = await exec('project_context_add', {
    project_id: projectId,
    path,
    scan: true,
  });
  return {
    project: result.ok ? ((result.project as Project) ?? null) : null,
    indexed: !!result.indexed,
    error: result.error,
  };
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const result = await exec('project_delete', { project_id: projectId });
  return !!result.ok && !!result.deleted;
}

export async function deleteJournalEntry(entryId: string): Promise<boolean> {
  const result = await exec('journal_delete', { entry_id: entryId });
  return !!result.ok && !!result.deleted;
}

export async function setConversationProject(
  conversationId: string,
  projectId: string | null,
): Promise<boolean> {
  const result = await exec('conversation_set_project', {
    conversation_id: conversationId,
    project_id: projectId,
  });
  return !!result.ok;
}
