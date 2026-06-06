/**
 * Workspace dependency bundling for self-contained publish / export / import /
 * VM deploy.
 *
 * A workspace workflow keeps its referenced pieces as separate files on disk —
 * imported sub-workflows under `imported/*.stuard`, helper code under `scripts/`,
 * config/data files, and binary assets (images, audio) under `assets/`. The main
 * spec only references them by path, so publishing, exporting, or deploying just
 * the spec leaves a downloader/VM with dangling `call_workspace_function`
 * references and missing scripts/assets.
 *
 * gatherWorkspaceBundle() reads those dependencies into the spec as
 * `__workspaceBundle`: text files in `files` (plain content) and binary files in
 * `binary` (base64). unpackWorkspaceBundle() writes them back into the importing
 * workflow's workspace (or, on the VM, the deploy dir), so downloaded/deployed
 * workflows run with zero manual setup — sub-workflows, functions, scripts,
 * JSON config, AND the images/audio they reference.
 */

export const WORKSPACE_BUNDLE_KEY = '__workspaceBundle';

// Keep payloads sane: skip oversized files and cap the whole bundle. The binary
// budget shares the total cap (base64 length counts ~1.33× the raw bytes).
const MAX_TEXT_FILE_BYTES = 1 * 1024 * 1024; // 1MB per text file
const MAX_BINARY_FILE_BYTES = 2 * 1024 * 1024; // 2MB per binary file (raw)
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024; // 8MB total (sum of stored string lengths)
// Text dependency types that make a workflow self-contained.
const TEXT_EXTENSIONS = new Set([
  'stuard', 'py', 'js', 'ts', 'mjs', 'cjs', 'json', 'jsonl', 'ndjson',
  'txt', 'md', 'csv', 'tsv', 'yaml', 'yml', 'env', 'sql', 'sh', 'toml', 'ini',
]);
// Binary assets a workflow may reference (images, audio, video, fonts, pdf).
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'tiff', 'avif',
  'wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'opus',
  'mp4', 'webm', 'mov', 'm4v',
  'pdf', 'woff', 'woff2', 'ttf', 'otf', 'zip', 'wasm', 'bin', 'dat',
]);
// Never bundle the root spec (that's the workflow itself) or VCS noise.
const SKIP_ROOT_FILES = new Set(['main.stuard']);

export interface WorkspaceBundle {
  /** 1 = text only (legacy). 2 = adds `binary`. */
  version: 1 | 2;
  /** Relative path → UTF-8 text content. */
  files: Record<string, string>;
  /** Relative path → base64-encoded bytes. */
  binary?: Record<string, string>;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Read a workspace workflow's text + binary dependencies into a bundle. Returns
 * null when the workflow isn't a workspace or has no extra files worth bundling.
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
  const binary: Record<string, string> = {};
  let total = 0;

  for (const entry of info.files) {
    if (!entry || entry.type !== 'file') continue;
    // getWorkspaceInfo returns backslash-separated paths; the read/write IPCs
    // expect forward slashes.
    const relPath = String(entry.path || '').replace(/\\/g, '/');
    if (!relPath) continue;
    // Skip the root main.stuard (the spec) and dotfiles.
    if (SKIP_ROOT_FILES.has(relPath) || relPath.split('/').some((p) => p.startsWith('.'))) continue;
    const ext = extOf(relPath);
    const size = typeof entry.size === 'number' ? entry.size : 0;

    if (TEXT_EXTENSIONS.has(ext)) {
      if (size > MAX_TEXT_FILE_BYTES) continue;
      try {
        const res = await api.workflowsReadWorkspaceFile(workflowId, relPath);
        if (res?.ok && typeof res.content === 'string') {
          if (total + res.content.length > MAX_BUNDLE_BYTES) break;
          total += res.content.length;
          files[relPath] = res.content;
        }
      } catch {
        // skip unreadable file
      }
    } else if (BINARY_EXTENSIONS.has(ext) && api.workflowsReadWorkspaceFileBinary) {
      if (size > MAX_BINARY_FILE_BYTES) continue;
      try {
        const res = await api.workflowsReadWorkspaceFileBinary(workflowId, relPath);
        if (res?.ok && typeof res.base64 === 'string') {
          if (total + res.base64.length > MAX_BUNDLE_BYTES) continue;
          total += res.base64.length;
          binary[relPath] = res.base64;
        }
      } catch {
        // skip unreadable file
      }
    }
  }

  const hasText = Object.keys(files).length > 0;
  const hasBinary = Object.keys(binary).length > 0;
  if (!hasText && !hasBinary) return null;
  const bundle: WorkspaceBundle = { version: hasBinary ? 2 : 1, files };
  if (hasBinary) bundle.binary = binary;
  return bundle;
}

/**
 * Attach a workspace bundle to a spec for publish/export/deploy. No-op (returns
 * the spec unchanged) when there's nothing to bundle.
 */
export async function withWorkspaceBundle<T extends Record<string, any>>(
  workflowId: string,
  spec: T,
): Promise<T> {
  const bundle = await gatherWorkspaceBundle(workflowId);
  if (!bundle) return spec;
  return { ...spec, [WORKSPACE_BUNDLE_KEY]: bundle };
}

/** True when a relative path is safe to write inside a workspace. */
function isSafeBundlePath(relPath: string): boolean {
  const safe = String(relPath).replace(/\\/g, '/');
  if (!safe) return false;
  // Don't let a crafted bundle escape the workspace or overwrite the spec.
  return !safe.includes('..') && !SKIP_ROOT_FILES.has(safe) && !safe.startsWith('/');
}

/**
 * Write a bundled workspace's files into the importing workflow's workspace.
 * Safe to call with any spec — it returns early when there's no bundle.
 */
export async function unpackWorkspaceBundle(workflowId: string, spec: any): Promise<void> {
  const bundle = spec?.[WORKSPACE_BUNDLE_KEY] as WorkspaceBundle | undefined;
  if (!bundle || typeof bundle !== 'object') return;
  const files = bundle.files && typeof bundle.files === 'object' ? bundle.files : {};
  const binary = bundle.binary && typeof bundle.binary === 'object' ? bundle.binary : {};
  if (Object.keys(files).length === 0 && Object.keys(binary).length === 0) return;

  const api = (window as any).desktopAPI;
  if (!api?.workflowsWriteWorkspaceFile) return;

  try {
    await api.workflowsEnsureWorkspace?.(workflowId);
  } catch {
    // best-effort — write below still creates parent dirs
  }

  for (const [relPath, content] of Object.entries(files)) {
    if (typeof content !== 'string' || !isSafeBundlePath(relPath)) continue;
    try {
      await api.workflowsWriteWorkspaceFile(workflowId, String(relPath).replace(/\\/g, '/'), content);
    } catch {
      // skip individual write failures
    }
  }

  if (api.workflowsWriteWorkspaceFileBinary) {
    for (const [relPath, base64] of Object.entries(binary)) {
      if (typeof base64 !== 'string' || !isSafeBundlePath(relPath)) continue;
      try {
        await api.workflowsWriteWorkspaceFileBinary(workflowId, String(relPath).replace(/\\/g, '/'), base64);
      } catch {
        // skip individual write failures
      }
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
