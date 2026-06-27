import { NextRequest, NextResponse } from 'next/server';
import { adminClient, signAttachmentUrls } from '@/lib/supportServer';

export const runtime = 'nodejs';

async function getAuthedUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

// GET /api/support/:id — fetch ticket + (non-internal) messages with signed attachment URLs
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthedUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;

  const db = adminClient();
  const { data: ticket, error: ticketErr } = await db
    .from('support_tickets')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (ticketErr) return NextResponse.json({ error: 'load_failed', message: ticketErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: messages, error: msgErr } = await db
    .from('support_ticket_messages')
    .select('id, author_type, author_name, content, attachments, created_at')
    .eq('ticket_id', id)
    .eq('internal_note', false)
    .order('created_at', { ascending: true });

  if (msgErr) return NextResponse.json({ error: 'messages_load_failed', message: msgErr.message }, { status: 500 });

  const messagesWithUrls = await signAttachmentUrls(db, messages || []);
  return NextResponse.json({ ticket, messages: messagesWithUrls });
}

// PATCH /api/support/:id — user can close their own ticket
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthedUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '').toLowerCase();
  if (action !== 'close') return NextResponse.json({ error: 'invalid_action' }, { status: 400 });

  const db = adminClient();
  const { data: ticket, error: loadErr } = await db
    .from('support_tickets')
    .select('id, user_id, status')
    .eq('id', id)
    .maybeSingle();

  if (loadErr) return NextResponse.json({ error: 'load_failed', message: loadErr.message }, { status: 500 });
  if (!ticket || ticket.user_id !== userId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await db
    .from('support_tickets')
    .update({ status: 'closed', resolved_at: ticket.status === 'resolved' ? undefined : now })
    .eq('id', id)
    .select()
    .single();

  if (updateErr) return NextResponse.json({ error: 'update_failed', message: updateErr.message }, { status: 500 });
  return NextResponse.json({ ticket: updated });
}
