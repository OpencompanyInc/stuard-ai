import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, verifyOpsToken } from '../../../lib/supabase-server';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
]);
const BUCKET = 'support-attachments';

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'file';
}

export async function POST(req: NextRequest) {
  if (!verifyOpsToken(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 500 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: 'invalid_form' }, { status: 400 });
  const file = form.get('file');
  const ticketId = String(form.get('ticket_id') || '').trim();
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'file_required' }, { status: 400 });
  if (!ticketId) return NextResponse.json({ ok: false, error: 'ticket_id_required' }, { status: 400 });

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'file_too_large', maxBytes: MAX_BYTES }, { status: 413 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ ok: false, error: 'unsupported_type', allowed: [...ALLOWED_MIME] }, { status: 415 });
  }

  const ext = safeName(file.name).split('.').pop() || 'bin';
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `staff/${ticketId}/${uniq}.${ext}`;

  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadErr) return NextResponse.json({ ok: false, error: 'upload_failed', message: uploadErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    attachment: {
      path,
      name: safeName(file.name),
      mime: file.type,
      size: file.size,
    },
  }, { status: 201 });
}
