/**
 * Local deploy version history for workflows.
 *
 * Every time a workflow is deployed locally (workflows_deploy), we snapshot the
 * deployed state into a per-workflow history store so the user can browse past
 * deploys and revert to one. This is intentionally separate from marketplace
 * publishing (which has its own version field) and from cloud deploys.
 *
 * Storage layout (kept OUTSIDE the workspace dir so it never leaks into the
 * workspace file browser, the VM workspace bundle, or agent-data sync):
 *
 *   <userData>/workflow-versions/<flowId>/
 *     versions.json                 ← manifest (chronological)
 *     <versionId>/workspace/...      ← full workspace tree snapshot (workspace flows)
 *     <versionId>/main.json          ← model snapshot (legacy flat .json flows)
 *     <versionId>/model.json         ← convenience copy of the deployed model
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';

const MAX_VERSIONS = 30;

export interface WorkflowVersionEntry {
  /** Folder-safe, time-sortable snapshot id. */
  id: string;
  /** 1-based sequence number assigned at deploy time. */
  version: number;
  /** ISO timestamp of the deploy that produced this version. */
  deployedAt: string;
  /** Workflow name at deploy time. */
  name: string;
  /** Trigger types active at deploy time (for display). */
  triggerTypes: string[];
  /** Node count at deploy time (for display). */
  nodeCount: number;
  /** Whether the snapshot is a full workspace tree or a single flat file. */
  storage: 'workspace' | 'file';
  /** Content hash, used to skip storing identical back-to-back deploys. */
  hash: string;
  /** What action produced this version. */
  source: 'deploy' | 'revert';
  /** When source === 'revert', the version number that was restored. */
  restoredFrom?: number;
  note?: string;
}

interface VersionsManifest {
  schema: 1;
  /** Last assigned sequence number. */
  seq: number;
  /** The version currently live on disk. */
  currentVersionId?: string;
  /** Chronological (oldest first). */
  versions: WorkflowVersionEntry[];
}

function safeId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function versionsRootFor(id: string): string {
  return path.join(app.getPath('userData'), 'workflow-versions', safeId(id));
}

function manifestPath(id: string): string {
  return path.join(versionsRootFor(id), 'versions.json');
}

function snapshotDir(id: string, versionId: string): string {
  return path.join(versionsRootFor(id), versionId);
}

function emptyManifest(): VersionsManifest {
  return { schema: 1, seq: 0, currentVersionId: undefined, versions: [] };
}

function readManifest(id: string): VersionsManifest {
  try {
    const raw = fs.readFileSync(manifestPath(id), 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    if (parsed && Array.isArray(parsed.versions)) {
      return {
        schema: 1,
        seq: Number(parsed.seq) || parsed.versions.length,
        currentVersionId: parsed.currentVersionId,
        versions: parsed.versions,
      };
    }
  } catch {
    // no manifest yet
  }
  return emptyManifest();
}

function writeManifest(id: string, manifest: VersionsManifest): void {
  const root = versionsRootFor(id);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(manifestPath(id), JSON.stringify(manifest, null, 2), 'utf-8');
}

function newVersionId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = crypto.randomBytes(3).toString('hex');
  return `${stamp}-${rand}`;
}

/** Recursively collect file paths (relative to root), excluding nothing special. */
function walkFiles(root: string, base = root, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(abs, base, out);
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs));
    }
  }
  return out;
}

/** Content hash over a workspace dir (sorted relative paths + bytes) or single file. */
function hashSource(sourcePath: string, storage: 'workspace' | 'file'): string {
  const h = crypto.createHash('sha256');
  try {
    if (storage === 'workspace') {
      const rels = walkFiles(sourcePath).sort();
      for (const rel of rels) {
        h.update(rel.replace(/\\/g, '/'));
        h.update('\0');
        try { h.update(fs.readFileSync(path.join(sourcePath, rel))); } catch {}
        h.update('\0');
      }
    } else {
      try { h.update(fs.readFileSync(sourcePath)); } catch {}
    }
  } catch {
    // fall through to whatever was hashed
  }
  return h.digest('hex');
}

function buildEntryMeta(model: any) {
  const triggerTypes = Array.isArray(model?.triggers)
    ? model.triggers.map((t: any) => String(t?.type || '')).filter(Boolean)
    : [];
  const nodeCount = Array.isArray(model?.nodes) ? model.nodes.length : 0;
  const name = String(model?.name || '').trim() || 'Untitled Workflow';
  return { triggerTypes, nodeCount, name };
}

function pruneOldVersions(id: string, manifest: VersionsManifest): void {
  while (manifest.versions.length > MAX_VERSIONS) {
    // Remove the oldest version that isn't the one currently live.
    const idx = manifest.versions.findIndex((v) => v.id !== manifest.currentVersionId);
    if (idx < 0) break;
    const [removed] = manifest.versions.splice(idx, 1);
    try { fs.rmSync(snapshotDir(id, removed.id), { recursive: true, force: true }); } catch {}
  }
}

export interface RecordDeployOptions {
  id: string;
  model: any;
  /** Workspace dir if this flow uses the workspace format; otherwise undefined. */
  workspaceDir?: string | null;
  /** Flat .json path for legacy non-workspace flows. */
  flatFilePath?: string | null;
  source?: 'deploy' | 'revert';
  restoredFrom?: number;
  note?: string;
}

export interface RecordDeployResult {
  ok: boolean;
  entry?: WorkflowVersionEntry;
  deduped?: boolean;
  error?: string;
}

/**
 * Snapshot the currently-deployed workflow as a new version.
 * Skips creating a new version if the content is byte-identical to the one
 * already live (e.g. a no-op redeploy).
 */
export function recordDeployVersion(opts: RecordDeployOptions): RecordDeployResult {
  try {
    const id = safeId(opts.id);
    if (!id) return { ok: false, error: 'invalid_id' };

    const storage: 'workspace' | 'file' = opts.workspaceDir ? 'workspace' : 'file';
    const sourcePath = storage === 'workspace'
      ? String(opts.workspaceDir)
      : String(opts.flatFilePath || '');
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'source_not_found' };
    }

    const manifest = readManifest(id);
    const hash = hashSource(sourcePath, storage);

    // Dedupe identical back-to-back deploys.
    const current = manifest.versions.find((v) => v.id === manifest.currentVersionId);
    if (current && current.hash === hash) {
      return { ok: true, entry: current, deduped: true };
    }

    const versionId = newVersionId();
    const destDir = snapshotDir(id, versionId);
    fs.mkdirSync(destDir, { recursive: true });

    if (storage === 'workspace') {
      fs.cpSync(sourcePath, path.join(destDir, 'workspace'), { recursive: true });
    } else {
      fs.copyFileSync(sourcePath, path.join(destDir, 'main.json'));
    }
    // Always keep a readable model copy for quick inspection / tooling.
    try { fs.writeFileSync(path.join(destDir, 'model.json'), JSON.stringify(opts.model ?? {}, null, 2), 'utf-8'); } catch {}

    const meta = buildEntryMeta(opts.model);
    const entry: WorkflowVersionEntry = {
      id: versionId,
      version: manifest.seq + 1,
      deployedAt: new Date().toISOString(),
      name: meta.name,
      triggerTypes: meta.triggerTypes,
      nodeCount: meta.nodeCount,
      storage,
      hash,
      source: opts.source || 'deploy',
      restoredFrom: opts.restoredFrom,
      note: opts.note,
    };

    manifest.seq = entry.version;
    manifest.versions.push(entry);
    manifest.currentVersionId = versionId;
    pruneOldVersions(id, manifest);
    writeManifest(id, manifest);

    return { ok: true, entry };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'snapshot_failed') };
  }
}

export interface ListVersionsResult {
  ok: boolean;
  versions: WorkflowVersionEntry[];
  currentVersionId?: string;
  error?: string;
}

/** Return versions newest-first along with which one is currently live. */
export function listWorkflowVersions(id: string): ListVersionsResult {
  try {
    const safe = safeId(id);
    if (!safe) return { ok: false, versions: [], error: 'invalid_id' };
    const manifest = readManifest(safe);
    return {
      ok: true,
      versions: [...manifest.versions].reverse(),
      currentVersionId: manifest.currentVersionId,
    };
  } catch (e: any) {
    return { ok: false, versions: [], error: String(e?.message || 'failed') };
  }
}

export interface RestoreVersionOptions {
  id: string;
  versionId: string;
  workspaceDir?: string | null;
  flatFilePath?: string | null;
}

export interface RestoreVersionResult {
  ok: boolean;
  model?: any;
  version?: number;
  error?: string;
}

/**
 * Restore a snapshot's files back into the live workflow location and mark it
 * as the current version. The caller is responsible for stopping/restarting the
 * runtime around this call.
 */
export function restoreWorkflowVersion(opts: RestoreVersionOptions): RestoreVersionResult {
  try {
    const id = safeId(opts.id);
    if (!id) return { ok: false, error: 'invalid_id' };

    const manifest = readManifest(id);
    const entry = manifest.versions.find((v) => v.id === opts.versionId);
    if (!entry) return { ok: false, error: 'version_not_found' };

    const snapRoot = snapshotDir(id, entry.id);

    if (entry.storage === 'workspace') {
      const live = opts.workspaceDir ? String(opts.workspaceDir) : '';
      if (!live) return { ok: false, error: 'workspace_dir_missing' };
      const snapWs = path.join(snapRoot, 'workspace');
      if (!fs.existsSync(snapWs)) return { ok: false, error: 'snapshot_missing' };

      // Swap safely: move current aside, copy snapshot in, drop backup on success.
      const bak = path.join(versionsRootFor(id), `.restore-bak-${Date.now()}`);
      let movedAside = false;
      try {
        if (fs.existsSync(live)) { fs.renameSync(live, bak); movedAside = true; }
        fs.cpSync(snapWs, live, { recursive: true });
        if (movedAside) { try { fs.rmSync(bak, { recursive: true, force: true }); } catch {} }
      } catch (e: any) {
        // Roll back to the pre-restore state.
        try { fs.rmSync(live, { recursive: true, force: true }); } catch {}
        if (movedAside) { try { fs.renameSync(bak, live); } catch {} }
        return { ok: false, error: String(e?.message || 'restore_failed') };
      }
    } else {
      const live = opts.flatFilePath ? String(opts.flatFilePath) : '';
      if (!live) return { ok: false, error: 'file_path_missing' };
      const snapFile = path.join(snapRoot, 'main.json');
      if (!fs.existsSync(snapFile)) return { ok: false, error: 'snapshot_missing' };
      fs.mkdirSync(path.dirname(live), { recursive: true });
      fs.copyFileSync(snapFile, live);
    }

    manifest.currentVersionId = entry.id;
    writeManifest(id, manifest);

    // Parse the restored model for the caller.
    let model: any = null;
    try {
      const modelPath = path.join(snapRoot, 'model.json');
      model = JSON.parse(fs.readFileSync(modelPath, 'utf-8') || '{}');
    } catch {}

    return { ok: true, model, version: entry.version };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Delete a single version snapshot (never the one currently live). */
export function deleteWorkflowVersion(id: string, versionId: string): { ok: boolean; error?: string } {
  try {
    const safe = safeId(id);
    if (!safe) return { ok: false, error: 'invalid_id' };
    const manifest = readManifest(safe);
    if (manifest.currentVersionId === versionId) {
      return { ok: false, error: 'cannot_delete_current' };
    }
    const idx = manifest.versions.findIndex((v) => v.id === versionId);
    if (idx < 0) return { ok: false, error: 'version_not_found' };
    manifest.versions.splice(idx, 1);
    try { fs.rmSync(snapshotDir(safe, versionId), { recursive: true, force: true }); } catch {}
    writeManifest(safe, manifest);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Remove all version history for a workflow (used when the flow is deleted). */
export function deleteAllWorkflowVersions(id: string): void {
  try {
    const safe = safeId(id);
    if (!safe) return;
    fs.rmSync(versionsRootFor(safe), { recursive: true, force: true });
  } catch {}
}
