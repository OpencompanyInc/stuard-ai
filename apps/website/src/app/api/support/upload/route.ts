import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
]);
const BUCKET = 'support-attachments';

function admin() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function getAuthedUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'file';
}

export async function POST(req: NextRequest) {
  const userId = await getAuthedUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 });

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file_too_large', maxBytes: MAX_BYTES }, { status: 413 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'unsupported_type', allowed: [...ALLOWED_MIME] }, { status: 415 });
  }

  const ext = safeName(file.name).split('.').pop() || 'bin';
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${userId}/${uniq}.${ext}`;

  const db = admin();
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (uploadErr) return NextResponse.json({ error: 'upload_failed', message: uploadErr.message }, { status: 500 });

  return NextResponse.json({
    attachment: {
      path,
      name: safeName(file.name),
      mime: file.type,
      size: file.size,
    },
  }, { status: 201 });
}
