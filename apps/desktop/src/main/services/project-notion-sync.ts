/**
 * Project ↔ Notion sync service (desktop side).
 *
 * Counterpart to cloud-ai's /v1/projects/notion/* routes (see
 * apps/cloud-ai/src/routes/projects-notion.ts). Cloud-ai talks to the Notion
 * API and normalizes content; this service owns the schedule and the local
 * state, because cloud-ai cannot push async results into the desktop's
 * memory.db:
 *
 *  - polls every linked project on a timer (plus manual "Sync now"),
 *  - relays the device-local Notion OAuth token (tokens are device-resident
 *    per the OAuth-local migration) and writes refreshed tokens back,
 *  - persists pulled pages/database rows as project-scoped memories in the
 *    agent DB (deduped by Notion id via deterministic memory ids),
 *  - pushes journal/timeline entries to the linked page when enabled,
 *  - stores sync state in projects.settings_json.notion.
 */

import logger from '../utils/logger';
import { getMainAccessToken } from './auth-session';

const SYNC_INTERVAL_MS = 15 * 60_000;
const FIRST_SWEEP_DELAY_MS = 60_000;
const MAX_PUSH_ENTRIES_PER_SYNC = 50;

export interface ProjectNotionSettings {
  /** Exactly one of page_id / database_id is set. */
  page_id?: string | null;
  database_id?: string | null;
  /** Display metadata for the linked target. */
  title?: string | null;
  url?: string | null;
  icon?: string | null;
  /** Push journal entries back to the linked page. */
  push_enabled?: boolean;
  /** OAuth profile label in the device token store. */
  profile?: string | null;
  linked_at?: string | null;
  last_synced_at?: string | null;
  /** Incremental pull cursor (Notion last_edited_time high-water mark). */
  last_pulled_at?: string | null;
  last_pushed_at?: string | null;
  last_error?: string | null;
  /** Notion block id of the "Stuard — Project Timeline" heading. */
  push_root_block_id?: string | null;
  /** journal entry id → Notion block id, for in-place updates. */
  pushed_entries?: Record<string, string>;
}

interface SyncSummary {
  ok: boolean;
  project_id: string;
  pulled?: number;
  pushed?: number;
  updated?: number;
  error?: string;
  synced_at?: string;
}

let timer: ReturnType<typeof setInterval> | null = null;
let firstSweepTimer: ReturnType<typeof setTimeout> | null = null;
let sweepRunning = false;
const projectSyncRunning = new Set<string>();

function agentHttpBase(): string {
  return String(process.env.AGENT_HTTP || 'http://127.0.0.1:8765').replace(/\/+$/, '');
}

function cloudAiHttpBase(): string {
  const url = String(
    process.env.CLOUD_AI_HTTP ||
    process.env.CLOUD_PUBLIC_URL ||
    process.env.VITE_CLOUD_AI_URL ||
    ''
  ).trim();
  return url ? url.replace(/\/+$/, '') : 'http://127.0.0.1:8082';
}

async function agentExec(tool: string, args: Record<string, unknown>, timeoutMs = 20_000): Promise<any> {
  try {
    const resp = await fetch(`${agentHttpBase()}/v1/tools/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return { ok: false, error: `agent_http_${resp.status}` };
    return await resp.json();
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function cloudPost(path: string, body: Record<string, unknown>, timeoutMs = 120_000): Promise<any> {
  const token = getMainAccessToken();
  if (!token) return { ok: false, error: 'not_signed_in' };
  try {
    const resp = await fetch(`${cloudAiHttpBase()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data: any = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, error: data?.error || `cloud_http_${resp.status}` };
    return data ?? { ok: false, error: 'empty_response' };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Device-local Notion token (with secrets) from the agent's OAuth store. */
async function getNotionTokens(profile?: string | null): Promise<{ access_token: string; refresh_token: string | null; profileLabel: string } | null> {
  const res = await agentExec('get_oauth_token', {
    provider: 'notion',
    profileLabel: profile || 'default',
  });
  const token = res?.ok ? res.token : null;
  if (!token?.accessToken) return null;
  return {
    access_token: String(token.accessToken),
    refresh_token: token.refreshToken ? String(token.refreshToken) : null,
    profileLabel: String(token.profileLabel || profile || 'default'),
  };
}

/** Write a refreshed token pair back to the device store (merge, not replace). */
async function storeRefreshedTokens(profileLabel: string, refreshed: { access_token?: string; refresh_token?: string | null } | null | undefined): Promise<void> {
  if (!refreshed?.access_token) return;
  await agentExec('store_oauth_tokens', {
    replace: false,
    tokens: [{
      provider: 'notion',
      profileLabel,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || null,
    }],
  });
}

function notionSettingsOf(project: any): ProjectNotionSettings | null {
  const notion = project?.settings?.notion;
  if (!notion || typeof notion !== 'object') return null;
  if (!notion.page_id && !notion.database_id) return null;
  return notion as ProjectNotionSettings;
}

/** Deterministic memory id so re-pulls overwrite instead of duplicating. */
function notionMemoryId(projectId: string, notionId: string): string {
  return `notion-${String(projectId).slice(0, 8)}-${String(notionId).replace(/[^a-zA-Z0-9-]/g, '')}`;
}

async function persistNotionSettings(project: any, nextNotion: ProjectNotionSettings | null): Promise<boolean> {
  const settings = { ...(project?.settings || {}) } as Record<string, unknown>;
  if (nextNotion) settings.notion = nextNotion;
  else delete settings.notion;
  const res = await agentExec('project_update', {
    project_id: project.id,
    settings,
  });
  return !!res?.ok;
}

/** Upsert one pulled Notion item as a project-scoped memory. */
async function upsertPulledItem(projectId: string, item: any): Promise<boolean> {
  const memoryId = notionMemoryId(projectId, String(item?.notion_id || ''));
  if (!memoryId) return false;
  // memory_create is insert-only, so delete-then-create acts as the upsert.
  await agentExec('memory_delete', { memory_id: memoryId });
  const created = await agentExec('memory_create', {
    memory_id: memoryId,
    type: 'note',
    title: String(item?.title || 'Untitled'),
    content: String(item?.content || '').trim() || String(item?.title || 'Untitled'),
    url: item?.url || undefined,
    project_ids: [projectId],
    source: 'notion',
    added_by: 'ai',
    metadata: {
      notion_id: item?.notion_id,
      notion_kind: item?.kind,
      notion_url: item?.url || null,
      last_edited_time: item?.last_edited_time || null,
    },
    embedding: Array.isArray(item?.embedding) && item.embedding.length > 0 ? item.embedding : undefined,
  });
  return !!created?.ok;
}

/** Journal entries that still need a push: never pushed, or edited since. */
function selectEntriesToPush(entries: any[], notion: ProjectNotionSettings): any[] {
  const pushed = notion.pushed_entries || {};
  const lastPushedAt = notion.last_pushed_at ? Date.parse(notion.last_pushed_at) : 0;
  const out: any[] = [];
  for (const entry of entries) {
    const id = String(entry?.id || '');
    if (!id) continue;
    if (!pushed[id]) {
      out.push(entry);
      continue;
    }
    const updatedAt = Date.parse(String(entry?.updated_at || entry?.created_at || ''));
    if (Number.isFinite(updatedAt) && lastPushedAt && updatedAt > lastPushedAt) {
      out.push(entry);
    }
  }
  return out.slice(0, MAX_PUSH_ENTRIES_PER_SYNC);
}

async function syncProject(project: any): Promise<SyncSummary> {
  const projectId = String(project?.id || '');
  const notion = notionSettingsOf(project);
  if (!projectId || !notion) return { ok: false, project_id: projectId, error: 'not_linked' };
  if (projectSyncRunning.has(projectId)) return { ok: false, project_id: projectId, error: 'sync_in_progress' };
  projectSyncRunning.add(projectId);

  try {
    const tokens = await getNotionTokens(notion.profile);

    // Journal entries ride along only when push is enabled and a page target
    // exists (databases can't receive appended blocks).
    let journalEntries: any[] = [];
    if (notion.push_enabled && notion.page_id) {
      const journal = await agentExec('journal_list', { project_id: projectId, limit: 300 });
      if (journal?.ok && Array.isArray(journal.entries)) {
        journalEntries = selectEntriesToPush(journal.entries, notion);
      }
    }

    const result = await cloudPost('/v1/projects/notion/sync', {
      project_id: projectId,
      notion: {
        page_id: notion.page_id || undefined,
        database_id: notion.database_id || undefined,
        push_enabled: !!notion.push_enabled,
        last_pulled_at: notion.last_pulled_at || null,
        push_root_block_id: notion.push_root_block_id || null,
        pushed_entries: notion.pushed_entries || {},
        profile: notion.profile || undefined,
      },
      // Token relay: device-local token preferred; cloud falls back to
      // VM-stored accounts when omitted.
      ...(tokens ? { access_token: tokens.access_token, refresh_token: tokens.refresh_token } : {}),
      ...(journalEntries.length > 0 ? { journal_entries: journalEntries } : {}),
    });

    if (tokens && result?.refreshed_tokens) {
      await storeRefreshedTokens(tokens.profileLabel, result.refreshed_tokens);
    }

    if (!result?.ok) {
      const error = String(result?.error || 'sync_failed');
      await persistNotionSettings(project, { ...notion, last_error: error });
      logger.warn(`[project-notion-sync] ${projectId} sync failed: ${error}`);
      return { ok: false, project_id: projectId, error };
    }

    const items: any[] = Array.isArray(result.items) ? result.items : [];
    let pulled = 0;
    let maxEdited = notion.last_pulled_at ? Date.parse(notion.last_pulled_at) : 0;
    for (const item of items) {
      if (await upsertPulledItem(projectId, item)) pulled++;
      const edited = Date.parse(String(item?.last_edited_time || ''));
      if (Number.isFinite(edited) && edited > maxEdited) maxEdited = edited;
    }

    const syncedAt = String(result.synced_at || new Date().toISOString());
    const next: ProjectNotionSettings = {
      ...notion,
      last_synced_at: syncedAt,
      last_pulled_at: maxEdited > 0 ? new Date(maxEdited).toISOString() : notion.last_pulled_at || null,
      last_error: result.push_error ? String(result.push_error) : null,
    };
    if (result.push) {
      next.pushed_entries = result.push.pushed_entries || notion.pushed_entries || {};
      next.push_root_block_id = result.push.push_root_block_id || notion.push_root_block_id || null;
      next.last_pushed_at = syncedAt;
    }
    await persistNotionSettings(project, next);

    const pushedCount = result.push?.pushed || 0;
    const updatedCount = result.push?.updated || 0;
    if (pulled > 0 || pushedCount > 0 || updatedCount > 0) {
      logger.info(`[project-notion-sync] ${projectId}: pulled ${pulled}, pushed ${pushedCount}, updated ${updatedCount}`);
    }
    return { ok: true, project_id: projectId, pulled, pushed: pushedCount, updated: updatedCount, synced_at: syncedAt };
  } catch (e: any) {
    const error = String(e?.message || e);
    logger.warn(`[project-notion-sync] ${projectId} sync errored: ${error}`);
    return { ok: false, project_id: projectId, error };
  } finally {
    projectSyncRunning.delete(projectId);
  }
}

async function sweepLinkedProjects(): Promise<void> {
  if (sweepRunning) return;
  if (!getMainAccessToken()) return; // signed out — nothing to relay through
  sweepRunning = true;
  try {
    const res = await agentExec('project_list', { limit: 200 });
    const projects: any[] = res?.ok && Array.isArray(res.projects) ? res.projects : [];
    for (const project of projects) {
      if (!notionSettingsOf(project)) continue;
      await syncProject(project);
    }
  } catch (e: any) {
    logger.warn(`[project-notion-sync] sweep failed: ${e?.message || e}`);
  } finally {
    sweepRunning = false;
  }
}

// ── Public API (IPC surface) ─────────────────────────────────────────────────

/** Search Notion pages/databases for the link picker. */
export async function searchProjectNotionTargets(query: string): Promise<{ ok: boolean; results?: any[]; error?: string }> {
  const tokens = await getNotionTokens(null);
  const result = await cloudPost('/v1/projects/notion/search', {
    query: String(query || ''),
    ...(tokens ? { access_token: tokens.access_token, refresh_token: tokens.refresh_token } : {}),
  }, 30_000);
  if (tokens && result?.refreshed_tokens) {
    await storeRefreshedTokens(tokens.profileLabel, result.refreshed_tokens);
  }
  if (!result?.ok) return { ok: false, error: String(result?.error || 'search_failed') };
  return { ok: true, results: Array.isArray(result.results) ? result.results : [] };
}

/** Link a Notion page/database to a project and kick off the first sync. */
export async function linkProjectNotion(
  projectId: string,
  target: { id: string; type: 'page' | 'database'; title?: string; url?: string | null; icon?: string | null },
  options?: { push_enabled?: boolean; profile?: string },
): Promise<{ ok: boolean; error?: string }> {
  const res = await agentExec('project_get', { project_id: projectId });
  if (!res?.ok || !res.project) return { ok: false, error: 'project_not_found' };

  const notion: ProjectNotionSettings = {
    page_id: target.type === 'page' ? target.id : null,
    database_id: target.type === 'database' ? target.id : null,
    title: target.title || null,
    url: target.url || null,
    icon: target.icon || null,
    push_enabled: !!options?.push_enabled,
    profile: options?.profile || 'default',
    linked_at: new Date().toISOString(),
    last_synced_at: null,
    last_pulled_at: null,
    last_pushed_at: null,
    last_error: null,
    push_root_block_id: null,
    pushed_entries: {},
  };
  const saved = await persistNotionSettings(res.project, notion);
  if (!saved) return { ok: false, error: 'settings_save_failed' };

  // First pull in the background — the UI polls project_get for status.
  void agentExec('project_get', { project_id: projectId }).then((fresh) => {
    if (fresh?.ok && fresh.project) void syncProject(fresh.project);
  });
  return { ok: true };
}

/** Patch the Notion link config (e.g. toggling push). */
export async function updateProjectNotion(
  projectId: string,
  patch: Partial<Pick<ProjectNotionSettings, 'push_enabled' | 'profile'>>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await agentExec('project_get', { project_id: projectId });
  if (!res?.ok || !res.project) return { ok: false, error: 'project_not_found' };
  const notion = notionSettingsOf(res.project);
  if (!notion) return { ok: false, error: 'not_linked' };
  const saved = await persistNotionSettings(res.project, { ...notion, ...patch });
  return saved ? { ok: true } : { ok: false, error: 'settings_save_failed' };
}

/** Unlink Notion and remove the synced copies from the project's Notes. */
export async function unlinkProjectNotion(projectId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await agentExec('project_get', { project_id: projectId });
  if (!res?.ok || !res.project) return { ok: false, error: 'project_not_found' };

  const memories = await agentExec('memory_list', { project_id: projectId, limit: 500 });
  if (memories?.ok && Array.isArray(memories.memories)) {
    for (const memory of memories.memories) {
      if (memory?.metadata?.notion_id || memory?.source === 'notion') {
        await agentExec('memory_delete', { memory_id: memory.id });
      }
    }
  }

  const saved = await persistNotionSettings(res.project, null);
  return saved ? { ok: true } : { ok: false, error: 'settings_save_failed' };
}

/** Manual "Sync now" for one project. */
export async function syncProjectNotionNow(projectId: string): Promise<SyncSummary> {
  const res = await agentExec('project_get', { project_id: projectId });
  if (!res?.ok || !res.project) return { ok: false, project_id: projectId, error: 'project_not_found' };
  return syncProject(res.project);
}

export function startProjectNotionSync(): void {
  if (timer) return;
  firstSweepTimer = setTimeout(() => { void sweepLinkedProjects(); }, FIRST_SWEEP_DELAY_MS);
  timer = setInterval(() => { void sweepLinkedProjects(); }, SYNC_INTERVAL_MS);
  logger.info('[project-notion-sync] started');
}

export function stopProjectNotionSync(): void {
  if (firstSweepTimer) { clearTimeout(firstSweepTimer); firstSweepTimer = null; }
  if (timer) { clearInterval(timer); timer = null; }
}
