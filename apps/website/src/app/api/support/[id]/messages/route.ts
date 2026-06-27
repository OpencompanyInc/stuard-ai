import { NextRequest, NextResponse } from 'next/server';
import { adminClient, signAttachmentUrls, validateAttachments } from '@/lib/supportServer';

export const runtime = 'nodejs';

async function getAuthedUser(req: NextRequest): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email || null };
}

// POST /api/support/:id/messages — user adds a reply (optionally with attachments)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const content = String(body.content || '').trim();
  if (!content) return NextResponse.json({ error: 'content_required' }, { status: 400 });
  if (content.length > 10000) return NextResponse.json({ error: 'content_too_long' }, { status: 400 });

  const attachmentsValidation = validateAttachments(body.attachments, user.id);
  if (!attachmentsValidation.ok) return NextResponse.json({ error: attachmentsValidation.error }, { status: 400 });
  const attachments = attachmentsValidation.value;

  const db = adminClient();
  const { data: ticket, error: loadErr } = await db
    .from('support_tickets')
    .select('id, user_id, status, name')
    .eq('id', id)
    .maybeSingle();

  if (loadErr) return NextResponse.json({ error: 'load_failed', message: loadErr.message }, { status: 500 });
  if (!ticket || ticket.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: message, error: insertErr } = await db
    .from('support_ticket_messages')
    .insert({
      ticket_id: id,
      user_id: user.id,
      author_type: 'user',
      author_name: ticket.name || user.email,
      content,
      attachments,
    })
    .select('id, author_type, author_name, content, attachments, created_at')
    .single();

  if (insertErr) return NextResponse.json({ error: 'insert_failed', message: insertErr.message }, { status: 500 });
  const [signed] = await signAttachmentUrls(db, [message]);
  return NextResponse.json({ message: signed }, { status: 201 });
}
