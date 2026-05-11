import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const SUPPORT_BUCKET = 'support-attachments';
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const ALLOWED_ATTACHMENT_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
]);
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export interface SupportAttachmentRecord {
  path: string;
  name: string;
  mime: string;
  size: number;
}

export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function validateAttachments(raw: unknown, userId: string): { ok: true; value: SupportAttachmentRecord[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'attachments_must_be_array' };
  if (raw.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: 'too_many_attachments' };
  }
  const cleaned: SupportAttachmentRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'invalid_attachment' };
    const a = item as Record<string, unknown>;
    const path = typeof a.path === 'string' ? a.path : '';
    const name = typeof a.name === 'string' ? a.name : '';
    const mime = typeof a.mime === 'string' ? a.mime : '';
    const size = typeof a.size === 'number' ? a.size : -1;
    if (!path || !path.startsWith(`${userId}/`)) return { ok: false, error: 'attachment_path_mismatch' };
    if (path.includes('..')) return { ok: false, error: 'invalid_attachment_path' };
    if (!name) return { ok: false, error: 'attachment_name_required' };
    if (!ALLOWED_ATTACHMENT_MIME.has(mime)) return { ok: false, error: 'unsupported_attachment_type' };
    if (!Number.isFinite(size) || size < 0 || size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: 'attachment_too_large' };
    }
    cleaned.push({ path, name, mime, size });
  }
  return { ok: true, value: cleaned };
}

export async function signAttachmentUrls<T extends { attachments?: unknown }>(
  db: SupabaseClient,
  rows: T[]
): Promise<T[]> {
  const allPaths = new Set<string>();
  for (const row of rows) {
    if (Array.isArray(row.attachments)) {
      for (const a of row.attachments) {
        if (a && typeof a === 'object' && typeof (a as { path?: unknown }).path === 'string') {
          allPaths.add((a as { path: string }).path);
        }
      }
    }
  }
  if (allPaths.size === 0) return rows;

  const urlMap = new Map<string, string>();
  const paths = [...allPaths];
  const { data } = await db.storage
    .from(SUPPORT_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  for (const entry of data || []) {
    if (entry.path && entry.signedUrl) urlMap.set(entry.path, entry.signedUrl);
  }

  return rows.map(row => {
    if (!Array.isArray(row.attachments)) return row;
    const next = (row.attachments as Array<Record<string, unknown>>).map(a => ({
      ...a,
      url: typeof a.path === 'string' ? urlMap.get(a.path) || null : null,
    }));
    return { ...row, attachments: next };
  });
}
