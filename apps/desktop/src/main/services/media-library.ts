import { app, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import logger from '../utils/logger';
import { getMainAccessToken, getMainUserId } from './auth-session';
import {
  isMediaLibraryItemVisibleInDashboard,
  shouldAutoRegisterToolMedia,
} from './media-library-policy';

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'unknown';
export type MediaSyncMode = 'local-only' | 'mirror-cloud';
export type MediaSyncStatus = 'local-only' | 'pending' | 'synced' | 'cloud-only' | 'failed';

export interface MediaLibraryItem {
  id: string;
  name: string;
  kind: MediaKind;
  source: string;
  classification: string;
  localPath: string | null;
  originalPath: string | null;
  remoteUrl: string | null;
  cloudObjectName: string | null;
  syncStatus: MediaSyncStatus;
  syncError: string | null;
  syncedAt: string | null;
  mimeType: string | null;
  extension: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  metadata: Record<string, any>;
}

export interface MediaLibraryPrefs {
  syncMode: MediaSyncMode;
}

export interface MediaLibrarySummary {
  total: number;
  totalBytes: number;
  synced: number;
  pending: number;
  failed: number;
  cloudOnly: number;
  byKind: Record<MediaKind, number>;
  bySource: Record<string, number>;
}

export interface RegisterLocalMediaOptions {
  filePath: string;
  source: string;
  toolName?: string;
  mimeType?: string | null;
  classification?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  preserveName?: boolean;
  /** When true, track the file at its current path without copying into the media library directory. */
  linkOnly?: boolean;
}

export interface RegisterRemoteMediaOptions {
  url: string;
  source: string;
  fileName?: string | null;
  mimeType?: string | null;
  classification?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  downloadToLibrary?: boolean;
}

type MediaLibraryStore = {
  items: MediaLibraryItem[];
};

const DEFAULT_PREFS: MediaLibraryPrefs = {
  syncMode: 'local-only',
};

let storeCache: MediaLibraryStore | null = null;
let prefsCache: MediaLibraryPrefs | null = null;
let syncPromise: Promise<{ ok: boolean; synced: number; failed: number; items: MediaLibraryItem[] }> | null = null;

function mediaRootDir() {
  return path.join(app.getPath('userData'), 'media-library');
}

function mediaDbPath() {
  return path.join(mediaRootDir(), 'media-index.json');
}

function mediaPrefsPath() {
  return path.join(mediaRootDir(), 'media-prefs.json');
}

function ensureMediaRoot() {
  fs.mkdirSync(mediaRootDir(), { recursive: true });
}

function normalizeTag(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function sanitizeFileName(name: string) {
  const ext = path.extname(name);
  const base = path.basename(name, ext)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${base || 'media'}${ext.toLowerCase()}`;
}

function timestampSlug(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function ensureDirForSource(source: string, createdAt = new Date()) {
  const yyyy = createdAt.getFullYear();
  const mm = String(createdAt.getMonth() + 1).padStart(2, '0');
  const sourceDir = path.join(
    mediaRootDir(),
    source
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'misc',
    `${yyyy}-${mm}`,
  );
  fs.mkdirSync(sourceDir, { recursive: true });
  return sourceDir;
}

function loadStore(): MediaLibraryStore {
  if (storeCache) return storeCache;
  ensureMediaRoot();
  try {
    if (fs.existsSync(mediaDbPath())) {
      const raw = fs.readFileSync(mediaDbPath(), 'utf-8');
      const parsed = JSON.parse(raw) as MediaLibraryStore;
      storeCache = {
        items: Array.isArray(parsed?.items) ? parsed.items : [],
      };
      return storeCache;
    }
  } catch (error) {
    logger.warn('[media-library] Failed to load store:', error);
  }
  storeCache = { items: [] };
  return storeCache;
}

function saveStore(store: MediaLibraryStore) {
  ensureMediaRoot();
  const normalized = {
    items: [...store.items].sort((a, b) => {
      const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      const aTime = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      return bTime - aTime;
    }),
  };
  fs.writeFileSync(mediaDbPath(), JSON.stringify(normalized, null, 2), 'utf-8');
  storeCache = normalized;
}

function loadPrefs(): MediaLibraryPrefs {
  if (prefsCache) return prefsCache;
  ensureMediaRoot();
  try {
    if (fs.existsSync(mediaPrefsPath())) {
      const raw = fs.readFileSync(mediaPrefsPath(), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<MediaLibraryPrefs>;
      prefsCache = {
        syncMode: parsed?.syncMode === 'mirror-cloud' ? 'mirror-cloud' : 'local-only',
      };
      return prefsCache;
    }
  } catch (error) {
    logger.warn('[media-library] Failed to load prefs:', error);
  }
  prefsCache = { ...DEFAULT_PREFS };
  return prefsCache;
}

function savePrefs(prefs: MediaLibraryPrefs) {
  ensureMediaRoot();
  fs.writeFileSync(mediaPrefsPath(), JSON.stringify(prefs, null, 2), 'utf-8');
  prefsCache = prefs;
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function encodePath(inputPath: string, preserveDrive: boolean) {
  return inputPath
    .split('/')
    .map((part, index) => {
      if (preserveDrive && index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
      return encodeURIComponent(part);
    })
    .join('/');
}

export function toLocalMediaUrl(filePath: string) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `local-file:///${encodePath(normalized, true)}`;
  }
  if (normalized.startsWith('/')) {
    return `local-file://${encodePath(normalized, false)}`;
  }
  return `local-file:///${encodePath(normalized, false)}`;
}

function inferMimeType(nameOrPath: string, mimeType?: string | null) {
  if (mimeType && mimeType.trim()) return mimeType.trim().toLowerCase();
  const ext = path.extname(nameOrPath || '').toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function inferKind(nameOrPath: string, mimeType?: string | null): MediaKind {
  const mime = inferMimeType(nameOrPath, mimeType);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime !== 'application/octet-stream') return 'document';
  return 'unknown';
}

function buildClassification(source: string, toolName?: string, kind?: MediaKind, metadata?: Record<string, any>) {
  if (source === 'generated') return 'Generated image';
  if (source === 'screenshots' || toolName === 'take_screenshot') return 'Screenshot';
  if (source === 'screen-recordings' || toolName === 'capture_screen') return 'Screen recording';
  if (source === 'message-media') {
    const provider = String(metadata?.provider || '').toLowerCase();
    if (provider === 'telnyx') return 'Telnyx MMS';
    if (provider === 'whatsapp') return 'WhatsApp media';
    return 'Message media';
  }
  if (toolName === 'text_to_speech') return 'Generated audio';
  if (toolName === 'capture_media') {
    const requestedKind = String(metadata?.requestedKind || '').toLowerCase();
    if (requestedKind === 'photo' || kind === 'image') return 'Photo capture';
    if (requestedKind === 'video' || requestedKind === 'audiovideo' || kind === 'video') return 'Video capture';
    if (requestedKind === 'audio' || kind === 'audio') return 'Audio capture';
  }
  if (source === 'imports') return 'Imported media';
  if (kind === 'image') return 'Image';
  if (kind === 'video') return 'Video';
  if (kind === 'audio') return 'Audio';
  return 'Media file';
}

function buildDefaultTags(source: string, kind: MediaKind, classification: string, metadata?: Record<string, any>) {
  const tags = new Set<string>();
  tags.add(kind);
  tags.add(normalizeTag(classification));
  if (source) tags.add(normalizeTag(source));
  const provider = String(metadata?.provider || '').trim();
  if (provider) tags.add(normalizeTag(provider));
  const requestedKind = String(metadata?.requestedKind || '').trim();
  if (requestedKind) tags.add(normalizeTag(requestedKind));
  return [...tags].filter(Boolean);
}

function findExistingItem(store: MediaLibraryStore, match: {
  localPath?: string | null;
  originalPath?: string | null;
  remoteUrl?: string | null;
  cloudObjectName?: string | null;
}) {
  return store.items.find((item) =>
    (match.localPath && item.localPath === match.localPath) ||
    (match.originalPath && item.originalPath === match.originalPath) ||
    (match.remoteUrl && item.remoteUrl === match.remoteUrl) ||
    (match.cloudObjectName && item.cloudObjectName === match.cloudObjectName)
  ) || null;
}

function upsertItem(store: MediaLibraryStore, nextItem: MediaLibraryItem) {
  const index = store.items.findIndex((item) => item.id === nextItem.id);
  if (index >= 0) {
    store.items[index] = nextItem;
  } else {
    store.items.unshift(nextItem);
  }
  saveStore(store);
  return nextItem;
}

function mergeItem(existing: MediaLibraryItem | null, patch: Partial<MediaLibraryItem>): MediaLibraryItem {
  const createdAt = existing?.createdAt || patch.createdAt || new Date().toISOString();
  return {
    id: existing?.id || patch.id || randomUUID(),
    name: patch.name ?? existing?.name ?? 'media',
    kind: patch.kind ?? existing?.kind ?? 'unknown',
    source: patch.source ?? existing?.source ?? 'misc',
    classification: patch.classification ?? existing?.classification ?? 'Media file',
    localPath: patch.localPath ?? existing?.localPath ?? null,
    originalPath: patch.originalPath ?? existing?.originalPath ?? null,
    remoteUrl: patch.remoteUrl ?? existing?.remoteUrl ?? null,
    cloudObjectName: patch.cloudObjectName ?? existing?.cloudObjectName ?? null,
    syncStatus: patch.syncStatus ?? existing?.syncStatus ?? 'local-only',
    syncError: patch.syncError ?? existing?.syncError ?? null,
    syncedAt: patch.syncedAt ?? existing?.syncedAt ?? null,
    mimeType: patch.mimeType ?? existing?.mimeType ?? null,
    extension: patch.extension ?? existing?.extension ?? null,
    sizeBytes: patch.sizeBytes ?? existing?.sizeBytes ?? null,
    createdAt,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
    tags: patch.tags ?? existing?.tags ?? [],
    metadata: {
      ...(existing?.metadata || {}),
      ...(patch.metadata || {}),
    },
  };
}

function fileExists(targetPath: string | null | undefined) {
  if (!targetPath) return false;
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

/** Check if a path is already inside a known StuardAI media directory (gallery or Documents). */
function isInMediaDirectory(filePath: string) {
  const normalized = path.resolve(filePath);
  if (normalized.startsWith(mediaRootDir())) return true;
  const docsMedia = path.join(require('os').homedir(), 'Documents', 'StuardAI', 'media');
  if (normalized.startsWith(path.resolve(docsMedia))) return true;
  return false;
}

function copyFileIntoLibrary(originalPath: string, source: string, preserveName = false) {
  const createdAt = new Date();
  const targetDir = ensureDirForSource(source, createdAt);
  const sanitizedName = sanitizeFileName(path.basename(originalPath));
  const preferredName = preserveName
    ? sanitizedName
    : `${timestampSlug(createdAt)}-${sanitizedName}`;
  const ext = path.extname(preferredName);
  const base = path.basename(preferredName, ext);
  let finalPath = path.join(targetDir, preferredName);
  let collisionIndex = 1;
  while (fs.existsSync(finalPath) && path.resolve(finalPath) !== path.resolve(originalPath)) {
    finalPath = path.join(targetDir, `${base}-${collisionIndex}${ext}`);
    collisionIndex += 1;
  }
  if (path.resolve(originalPath) !== path.resolve(finalPath)) {
    fs.copyFileSync(originalPath, finalPath);
  }
  return finalPath;
}

function cloudBaseUrl() {
  return String(
    process.env.CLOUD_AI_HTTP ||
    process.env.CLOUD_PUBLIC_URL ||
    process.env.VITE_CLOUD_AI_URL ||
    'http://127.0.0.1:8082'
  ).trim().replace(/\/+$/, '');
}

async function uploadFileToCloud(item: MediaLibraryItem) {
  if (!item.localPath || !fileExists(item.localPath)) {
    throw new Error('local_file_missing');
  }
  const token = getMainAccessToken();
  const userId = getMainUserId();
  if (!token || !userId) {
    throw new Error('cloud_auth_missing');
  }

  const buffer = fs.readFileSync(item.localPath);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': item.mimeType || 'application/octet-stream',
    'X-Filename': item.name,
    'X-File-Path': `media-library/${userId}/${item.source}`,
  };

  const resp = await net.fetch(`${cloudBaseUrl()}/v1/cloud-storage/upload`, {
    method: 'POST',
    headers,
    body: buffer,
  });
  const data = await resp.json().catch(() => ({} as any));
  if (!resp.ok || !data?.ok) {
    throw new Error(String(data?.message || data?.error || `upload_failed_${resp.status}`));
  }
  return {
    objectName: String(data.objectName || ''),
  };
}

function extractAttachmentUrl(input: any): string | null {
  if (!input) return null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed || null;
  }
  const candidates = [
    input.url,
    input.downloadUrl,
    input.mediaUrl,
    input.href,
    input.path,
    input.filePath,
    input.localPath,
    input.image_url?.url,
    input.video_url?.url,
    input.audio_url?.url,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  return null;
}

export function getMediaLibraryPrefs() {
  return { ...loadPrefs() };
}

export function updateMediaLibraryPrefs(updates: Partial<MediaLibraryPrefs>) {
  const currentPrefs = loadPrefs();
  const nextPrefs: MediaLibraryPrefs = {
    syncMode: updates.syncMode === 'mirror-cloud'
      ? 'mirror-cloud'
      : updates.syncMode === 'local-only'
        ? 'local-only'
        : currentPrefs.syncMode,
  };
  savePrefs(nextPrefs);
  if (currentPrefs.syncMode !== 'mirror-cloud' && nextPrefs.syncMode === 'mirror-cloud') {
    void syncMediaLibrary().catch((error) => {
      logger.warn('[media-library] Failed to auto-sync after enabling mirror-cloud:', error);
    });
  }
  return nextPrefs;
}

export function listMediaLibraryItems() {
  const store = loadStore();
  return store.items.filter((item) => {
    if (!isMediaLibraryItemVisibleInDashboard(item)) return false;
    if (item.localPath && !fileExists(item.localPath) && item.syncStatus !== 'cloud-only') {
      return !!item.remoteUrl || !!item.cloudObjectName;
    }
    return true;
  });
}

export function getMediaLibrarySummary(): MediaLibrarySummary {
  const items = listMediaLibraryItems();
  const byKind: Record<MediaKind, number> = {
    image: 0,
    video: 0,
    audio: 0,
    document: 0,
    unknown: 0,
  };
  const bySource: Record<string, number> = {};
  let totalBytes = 0;
  let synced = 0;
  let pending = 0;
  let failed = 0;
  let cloudOnly = 0;

  for (const item of items) {
    byKind[item.kind] += 1;
    bySource[item.source] = (bySource[item.source] || 0) + 1;
    totalBytes += item.sizeBytes || 0;
    if (item.syncStatus === 'synced') synced += 1;
    if (item.syncStatus === 'pending') pending += 1;
    if (item.syncStatus === 'failed') failed += 1;
    if (item.syncStatus === 'cloud-only') cloudOnly += 1;
  }

  return {
    total: items.length,
    totalBytes,
    synced,
    pending,
    failed,
    cloudOnly,
    byKind,
    bySource,
  };
}

export async function registerLocalMedia(options: RegisterLocalMediaOptions) {
  const source = String(options.source || 'misc').trim() || 'misc';
  const originalPath = path.resolve(String(options.filePath || '').trim());
  if (!originalPath) {
    throw new Error('missing_media_path');
  }
  if (!fs.existsSync(originalPath)) {
    throw new Error(`media_file_not_found: ${originalPath}`);
  }

  ensureMediaRoot();
  const store = loadStore();
  const existing = findExistingItem(store, {
    localPath: originalPath,
    originalPath,
  });

  const finalPath = options.linkOnly || originalPath.startsWith(mediaRootDir())
    ? originalPath
    : copyFileIntoLibrary(originalPath, source, options.preserveName);

  const stat = fs.statSync(finalPath);
  const mimeType = inferMimeType(finalPath, options.mimeType);
  const kind = inferKind(finalPath, mimeType);
  const classification = options.classification || buildClassification(source, options.toolName, kind, options.metadata);
  const tags = Array.from(new Set([
    ...buildDefaultTags(source, kind, classification, options.metadata),
    ...((options.tags || []).map(normalizeTag)),
  ])).filter(Boolean);

  const item = mergeItem(existing, {
    name: path.basename(finalPath),
    kind,
    source,
    classification,
    localPath: finalPath,
    originalPath,
    remoteUrl: existing?.remoteUrl || null,
    syncStatus: existing?.syncStatus === 'synced' ? 'synced' : 'local-only',
    syncError: null,
    mimeType,
    extension: path.extname(finalPath).toLowerCase() || null,
    sizeBytes: stat.size,
    tags,
    metadata: {
      toolName: options.toolName || null,
      ...options.metadata,
    },
  });

  const savedItem = upsertItem(store, item);
  if (loadPrefs().syncMode === 'mirror-cloud') {
    void syncMediaLibrary([savedItem.id]).catch((error) => {
      logger.warn('[media-library] Auto-sync failed:', error);
    });
  }
  return savedItem;
}

export async function registerRemoteMedia(options: RegisterRemoteMediaOptions) {
  const url = String(options.url || '').trim();
  if (!url) {
    throw new Error('missing_remote_media_url');
  }

  const source = String(options.source || 'message-media').trim() || 'message-media';
  const fileName = options.fileName
    ? sanitizeFileName(options.fileName)
    : sanitizeFileName(path.basename(new URL(url).pathname || 'media.bin'));

  if (options.downloadToLibrary !== false && looksLikeUrl(url)) {
    try {
      const resp = await net.fetch(url);
      if (resp.ok) {
        const arrayBuffer = await resp.arrayBuffer();
        const targetDir = ensureDirForSource(source, new Date());
        const targetPath = path.join(targetDir, `${timestampSlug()}-${fileName}`);
        fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
        return registerLocalMedia({
          filePath: targetPath,
          source,
          toolName: 'incoming_media',
          mimeType: options.mimeType || resp.headers.get('content-type'),
          classification: options.classification,
          tags: options.tags,
          metadata: {
            remoteUrl: url,
            ...options.metadata,
          },
          preserveName: true,
        });
      }
    } catch (error) {
      logger.warn('[media-library] Failed downloading remote media:', error);
    }
  }

  const store = loadStore();
  const existing = findExistingItem(store, { remoteUrl: url });
  const mimeType = inferMimeType(fileName, options.mimeType);
  const kind = inferKind(fileName, mimeType);
  const classification = options.classification || buildClassification(source, 'incoming_media', kind, options.metadata);
  const tags = Array.from(new Set([
    ...buildDefaultTags(source, kind, classification, options.metadata),
    ...((options.tags || []).map(normalizeTag)),
  ])).filter(Boolean);

  const item = mergeItem(existing, {
    name: fileName,
    kind,
    source,
    classification,
    localPath: null,
    originalPath: null,
    remoteUrl: url,
    cloudObjectName: existing?.cloudObjectName || null,
    syncStatus: 'cloud-only',
    syncError: null,
    mimeType,
    extension: path.extname(fileName).toLowerCase() || null,
    sizeBytes: null,
    tags,
    metadata: options.metadata || {},
  });

  return upsertItem(store, item);
}

export async function importMediaPaths(paths: string[]) {
  const imported: MediaLibraryItem[] = [];
  for (const filePath of paths) {
    try {
      const item = await registerLocalMedia({
        filePath,
        source: 'imports',
        classification: 'Imported media',
      });
      imported.push(item);
    } catch (error) {
      logger.warn('[media-library] Failed to import path:', filePath, error);
    }
  }
  return imported;
}

export async function syncMediaLibrary(itemIds?: string[]) {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    const store = loadStore();
    const selectedIds = Array.isArray(itemIds) && itemIds.length > 0
      ? new Set(itemIds)
      : null;
    const candidates = store.items.filter((item) => {
      if (selectedIds && !selectedIds.has(item.id)) return false;
      if (!isMediaLibraryItemVisibleInDashboard(item)) return false;
      if (!item.localPath || !fileExists(item.localPath)) return false;
      return item.syncStatus !== 'synced';
    });

    let synced = 0;
    let failed = 0;

    for (const item of candidates) {
      const pendingItem = mergeItem(item, {
        syncStatus: 'pending',
        syncError: null,
      });
      upsertItem(store, pendingItem);

      try {
        const upload = await uploadFileToCloud(pendingItem);
        const syncedItem = mergeItem(pendingItem, {
          cloudObjectName: upload.objectName || pendingItem.cloudObjectName,
          syncStatus: 'synced',
          syncedAt: new Date().toISOString(),
          syncError: null,
        });
        upsertItem(store, syncedItem);
        synced += 1;
      } catch (error: any) {
        const failedItem = mergeItem(pendingItem, {
          syncStatus: 'failed',
          syncError: String(error?.message || error || 'sync_failed'),
        });
        upsertItem(store, failedItem);
        failed += 1;
      }
    }

    return {
      ok: true,
      synced,
      failed,
      items: listMediaLibraryItems(),
    };
  })();

  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}

export async function registerIncomingMessagingMedia(provider: string, attachments: any[]) {
  const safeProvider = String(provider || 'telnyx').trim().toLowerCase() || 'telnyx';
  const imported: MediaLibraryItem[] = [];

  for (const attachment of attachments || []) {
    try {
      const ref = extractAttachmentUrl(attachment);
      if (!ref) continue;

      const fileName = String(
        attachment?.filename ||
        attachment?.name ||
        attachment?.title ||
        path.basename(ref.split('?')[0] || 'message-media.bin')
      ).trim();

      const mimeType = String(
        attachment?.mimeType ||
        attachment?.contentType ||
        attachment?.type ||
        ''
      ).trim() || null;

      if (looksLikeUrl(ref)) {
        imported.push(await registerRemoteMedia({
          url: ref,
          fileName,
          mimeType,
          source: 'message-media',
          classification: safeProvider === 'telnyx' ? 'Telnyx MMS' : 'WhatsApp media',
          tags: ['message-media', safeProvider],
          metadata: {
            provider: safeProvider,
            attachment,
          },
          downloadToLibrary: true,
        }));
      } else if (fs.existsSync(ref)) {
        imported.push(await registerLocalMedia({
          filePath: ref,
          source: 'message-media',
          toolName: 'incoming_media',
          mimeType,
          classification: safeProvider === 'telnyx' ? 'Telnyx MMS' : 'WhatsApp media',
          tags: ['message-media', safeProvider],
          metadata: {
            provider: safeProvider,
            attachment,
          },
        }));
      }
    } catch (error) {
      logger.warn('[media-library] Failed to ingest messaging media:', error);
    }
  }

  return imported;
}

export function deleteMediaItem(itemId: string, deleteFile = true) {
  const store = loadStore();
  const index = store.items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    return { ok: false, error: 'item_not_found' };
  }
  const item = store.items[index];
  if (deleteFile && item.localPath && fileExists(item.localPath)) {
    try {
      fs.unlinkSync(item.localPath);
    } catch (error) {
      logger.warn('[media-library] Failed to delete file:', error);
    }
  }
  store.items.splice(index, 1);
  saveStore(store);
  return { ok: true, id: itemId };
}

export async function captureToolMedia(toolName: string, args: any, result: any) {
  if (!result || result.ok === false) return result;
  if (!shouldAutoRegisterToolMedia(toolName)) return result;

  if (toolName === 'generate_image' && Array.isArray(result.images)) {
    const images = await Promise.all(
      result.images.map(async (image: any) => {
        const filePath = String(image?.filePath || '').trim();
        if (!filePath || !fs.existsSync(filePath)) return image;
        try {
          const item = await registerLocalMedia({
            filePath,
            source: 'generated',
            toolName,
            mimeType: image?.format ? `image/${image.format === 'jpg' ? 'jpeg' : image.format}` : null,
            classification: 'Generated image',
            tags: ['generated', 'ai'],
            metadata: {
              model: result.model || null,
              provider: result.provider || null,
              prompt: result.prompt || null,
              revisedPrompt: image?.revisedPrompt || null,
            },
            preserveName: true,
            linkOnly: isInMediaDirectory(filePath),
          });
          return {
            ...image,
            filePath: item.localPath || image.filePath,
            mediaLibraryId: item.id,
            syncStatus: item.syncStatus,
          };
        } catch (error) {
          logger.warn('[media-library] Failed to capture generated image:', error);
          return image;
        }
      })
    );

    return {
      ...result,
      images,
    };
  }

  const fileTargets: Array<{
    field: 'filePath' | 'audioFilePath';
    source: string;
    classification?: string;
    tags?: string[];
    metadata?: Record<string, any>;
  }> = [];

  if (toolName === 'take_screenshot' && result.filePath) {
    fileTargets.push({
      field: 'filePath',
      source: 'screenshots',
      classification: 'Screenshot',
      tags: ['screenshot', 'screen'],
    });
  }

  if ((toolName === 'capture_media' || toolName === 'stop_capture') && result.filePath) {
    const requestedKind = String(args?.kind || result?.mimeType || '').toLowerCase();
    const kind = inferKind(String(result.filePath), String(result.mimeType || ''));
    const source = kind === 'image'
      ? 'photos'
      : kind === 'audio'
        ? 'audio-recordings'
        : 'video-recordings';
    fileTargets.push({
      field: 'filePath',
      source,
      tags: ['capture', kind],
      metadata: {
        requestedKind,
        mode: args?.mode || result?.mode || null,
      },
    });
  }

  if (toolName === 'capture_screen' && result.filePath) {
    fileTargets.push({
      field: 'filePath',
      source: 'screen-recordings',
      classification: 'Screen recording',
      tags: ['screen-recording', 'screen'],
      metadata: {
        includeSystemAudio: !!args?.includeSystemAudio,
        target: args?.target || null,
      },
    });
  }

  if (toolName === 'capture_screen' && result.audioFilePath) {
    fileTargets.push({
      field: 'audioFilePath',
      source: 'screen-audio',
      classification: 'Screen audio',
      tags: ['screen-audio', 'audio'],
    });
  }

  if (toolName === 'text_to_speech' && result.filePath) {
    fileTargets.push({
      field: 'filePath',
      source: 'generated-audio',
      classification: 'Generated audio',
      tags: ['tts', 'audio'],
      metadata: {
        voice: result.voice_id || null,
        model: result.model_id || null,
      },
    });
  }

  if (fileTargets.length === 0) return result;

  let nextResult = { ...result };
  for (const target of fileTargets) {
    const currentPath = String(nextResult[target.field] || '').trim();
    if (!currentPath || !fs.existsSync(currentPath)) continue;
    try {
      const item = await registerLocalMedia({
        filePath: currentPath,
        source: target.source,
        toolName,
        mimeType: target.field === 'audioFilePath' ? null : nextResult.mimeType || null,
        classification: target.classification,
        tags: target.tags,
        metadata: {
          ...target.metadata,
          toolName,
        },
        linkOnly: isInMediaDirectory(currentPath),
      });
      nextResult = {
        ...nextResult,
        [target.field]: item.localPath || currentPath,
        mediaLibraryId: item.id,
        syncStatus: item.syncStatus,
      };
    } catch (error) {
      logger.warn('[media-library] Failed to capture tool media:', error);
    }
  }

  return nextResult;
}
