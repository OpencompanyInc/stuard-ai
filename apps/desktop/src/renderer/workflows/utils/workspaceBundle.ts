/**
 * Workspace dependency bundling for self-contained publish / export / import.
 *
 * A workspace workflow keeps its referenced pieces as separate files on disk —
 * imported sub-workflows under `imported/*.stuard`, helper code under `scripts/`,
 * and config/data files. The main spec only references them by path, so
 * publishing or exporting just the spec leaves a downloader with dangling
 * `call_workspace_function` references and missing scripts.
 *
 * gatherWorkspaceBundle() reads those text dependencies into a flat
 * { relPath: content } map embedded on the spec as `__workspaceBundle`.
 * unpackWorkspaceBundle() writes them back into the importer's workspace, so
 * downloaded workflows run with zero manual setup.
 *
 * Binary assets are intentionally skipped in this pass (they'd need base64
 * round-tripping); the functional dependencies users hit — sub-workflows,
 * functions, scripts, JSON config — are all text.
 */

export const WORKSPACE_BUNDLE_KEY = '__workspaceBundle';

// Keep marketplace payloads sane: skip oversized files and cap the whole bundle.
const MAX_FILE_BYTES = 1 * 1024 * 1024; // 1MB per file
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024; // 8MB total
// Text dependency types that make a workflow self-contained.
const BUNDLE_EXTENSIONS = new Set([
  'stuard', 'py', 'js', 'ts', 'mjs', 'cjs', 'json', 'jsonl', 'ndjson',
  'txt', 'md', 'csv', 'tsv', 'yaml', 'yml', 'env', 'sql', 'sh', 'toml', 'ini',
]);
// Never bundle the root spec (that's the workflow itself) or VCS noise.
const SKIP_ROOT_FILES = new Set(['main.stuard']);

export interface WorkspaceBundle {
  version: 1;
  files: Record<string, string>;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Read a workspace workflow's text dependencies into a bundle. Returns null when
 * the workflow isn't a workspace or has no extra files worth bundling.
 */
export async function gatherWorkspaceBundle(workflowId: string): Promise<WorkspaceBundle | null> {
  const api = (window as any).desktopAPI;
  if (!api?.workflowsGetWorkspaceInfo || !workflowId) return null;

  let info: any;
  try {
    info = await api.workflowsGetWorkspaceInfo(workflowId);
  } catch {
    return null;
  }
  if (!info?.ok || !Array.isArray(info.files)) return null;

  const files: Record<string, string> = {};
  let total = 0;

  for (const entry of info.files) {
    if (!entry || entry.type !== 'file') continue;
    // getWorkspaceInfo returns backslash-separated paths; the read/write IPCs
    // expect forward slashes.
    const relPath = String(entry.path || '').replace(/\\/g, '/');
    if (!relPath) continue;
    // Skip the root main.stuard (the spec) and dotfiles.
    if (SKIP_ROOT_FILES.has(relPath) || relPath.split('/').some((p) => p.startsWith('.'))) continue;
    if (!BUNDLE_EXTENSIONS.has(extOf(relPath))) continue;
    if (typeof entry.size === 'number' && entry.size > MAX_FILE_BYTES) continue;

    try {
      const res = await api.workflowsReadWorkspaceFile(workflowId, relPath);
      if (res?.ok && typeof res.content === 'string') {
        total += res.content.length;
        if (total > MAX_BUNDLE_BYTES) break;
        files[relPath] = res.content;
      }
    } catch {
      // skip unreadable file
    }
  }

  if (Object.keys(files).length === 0) return null;
  return { version: 1, files };
}

/**
 * Attach a workspace bundle to a spec for publish/export. No-op (returns the
 * spec unchanged) when there's nothing to bundle.
 */
export async function withWorkspaceBundle<T extends Record<string, any>>(
  workflowId: string,
  spec: T,
): Promise<T> {
  const bundle = await gatherWorkspaceBundle(workflowId);
  if (!bundle) return spec;
  return { ...spec, [WORKSPACE_BUNDLE_KEY]: bundle };
}

/**
 * Write a bundled workspace's files into the importing workflow's workspace.
 * Safe to call with any spec — it returns early when there's no bundle.
 */
export async function unpackWorkspaceBundle(workflowId: string, spec: any): Promise<void> {
  const bundle = spec?.[WORKSPACE_BUNDLE_KEY] as WorkspaceBundle | undefined;
  if (!bundle || !bundle.files || typeof bundle.files !== 'object') return;

  const api = (window as any).desktopAPI;
  if (!api?.workflowsWriteWorkspaceFile) return;

  try {
    await api.workflowsEnsureWorkspace?.(workflowId);
  } catch {
    // best-effort — write below still creates parent dirs
  }

  for (const [relPath, content] of Object.entries(bundle.files)) {
    if (typeof content !== 'string') continue;
    const safe = String(relPath).replace(/\\/g, '/');
    // Don't let a crafted bundle escape the workspace or overwrite the spec.
    if (safe.includes('..') || SKIP_ROOT_FILES.has(safe) || safe.startsWith('/')) continue;
    try {
      await api.workflowsWriteWorkspaceFile(workflowId, safe, content);
    } catch {
      // skip individual write failures
    }
  }
}

/** Remove the bundle from a spec before it's saved as the local main model. */
export function stripWorkspaceBundle<T extends Record<string, any>>(spec: T): T {
  if (!spec || !(WORKSPACE_BUNDLE_KEY in spec)) return spec;
  const clone = { ...spec };
  delete (clone as any)[WORKSPACE_BUNDLE_KEY];
  return clone;
}
