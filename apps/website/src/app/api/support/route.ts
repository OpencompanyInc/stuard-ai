import { NextRequest, NextResponse } from 'next/server';
import { adminClient, validateAttachments } from '@/lib/supportServer';

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

const VALID_CATEGORIES = ['general', 'billing', 'technical', 'account', 'feature_request', 'bug_report', 'other'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

// GET /api/support — list current user's tickets
export async function GET(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await adminClient()
    .from('support_tickets')
    .select('id, subject, category, priority, status, last_message_at, last_message_by, created_at, updated_at, resolved_at')
    .eq('user_id', user.id)
    .order('last_message_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: 'load_failed', message: error.message }, { status: 500 });
  return NextResponse.json({ tickets: data || [] });
}

// POST /api/support — create a ticket (also inserts the first message)
export async function POST(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const subject = String(body.subject || '').trim();
  const message = String(body.message || '').trim();
  const category = String(body.category || 'general').trim().toLowerCase();
  const priority = String(body.priority || 'medium').trim().toLowerCase();
  const name = body.name ? String(body.name).trim() : null;

  if (!subject) return NextResponse.json({ error: 'subject_required' }, { status: 400 });
  if (subject.length > 200) return NextResponse.json({ error: 'subject_too_long' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'message_required' }, { status: 400 });
  if (message.length > 10000) return NextResponse.json({ error: 'message_too_long' }, { status: 400 });
  if (!VALID_CATEGORIES.includes(category)) return NextResponse.json({ error: 'invalid_category' }, { status: 400 });
  if (!VALID_PRIORITIES.includes(priority)) return NextResponse.json({ error: 'invalid_priority' }, { status: 400 });

  const attachmentsValidation = validateAttachments(body.attachments, user.id);
  if (!attachmentsValidation.ok) return NextResponse.json({ error: attachmentsValidation.error }, { status: 400 });
  const attachments = attachmentsValidation.value;

  const db = adminClient();
  const now = new Date().toISOString();

  const { data: ticket, error: ticketErr } = await db
    .from('support_tickets')
    .insert({
      user_id: user.id,
      email: user.email || 'unknown@unknown',
      name,
      subject,
      category,
      priority,
      status: 'open',
      last_message_at: now,
      last_message_by: 'user',
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    })
    .select()
    .single();

  if (ticketErr || !ticket) {
    return NextResponse.json({ error: 'create_failed', message: ticketErr?.message }, { status: 500 });
  }

  const { error: msgErr } = await db.from('support_ticket_messages').insert({
    ticket_id: ticket.id,
    user_id: user.id,
    author_type: 'user',
    author_name: name || user.email,
    content: message,
    attachments,
  });

  if (msgErr) {
    return NextResponse.json({ error: 'message_failed', message: msgErr.message, ticket }, { status: 500 });
  }

  return NextResponse.json({ ticket }, { status: 201 });
}
