import { getSupabaseAdmin } from '../supabase';
import { WHATSAPP_INTEGRATION_ENABLED } from '../../../../shared/integration-flags';

// ─────────────────────────────────────────────────────────────────────────────
// Internal: auto-sync a reminder to cloud when cloud_notify is set
// Called from the task_reminders wrapper when action=schedule
// ─────────────────────────────────────────────────────────────────────────────

export async function syncReminderToCloud(
  userId: string,
  opts: {
    when: string;
    message: string;
    recurrence?: any;
    cloud_notify_method?: 'sms' | 'whatsapp' | 'both';
  },
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  // Resolve timezone from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .single();

  const tz = (profile as any)?.timezone || 'UTC';
  let method = opts.cloud_notify_method || 'sms';
  if (!WHATSAPP_INTEGRATION_ENABLED) {
    if (method === 'whatsapp' || method === 'both') method = 'sms';
  }

  // Parse the "when" value
  let remindAt: Date;
  const raw = String(opts.when);
  if (/^\d+$/.test(raw)) {
    // Relative seconds
    remindAt = new Date(Date.now() + Number(raw) * 1000);
  } else {
    remindAt = new Date(raw);
    if (isNaN(remindAt.getTime())) return;
  }

  await supabase.from('cloud_reminders').insert({
    user_id: userId,
    title: opts.message || 'Reminder',
    message: opts.message || null,
    remind_at: remindAt.toISOString(),
    timezone: tz,
    delivery_method: method,
    recurrence: opts.recurrence || null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Query: get pending cloud reminders for a user (used by planner + dashboard)
// ─────────────────────────────────────────────────────────────────────────────

export async function getCloudReminders(
  userId: string,
  opts?: { status?: string; start?: string; end?: string; limit?: number },
): Promise<any[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  let query = supabase
    .from('cloud_reminders')
    .select('*')
    .eq('user_id', userId)
    .order('remind_at', { ascending: true })
    .limit(opts?.limit || 100);

  if (opts?.status && opts.status !== 'all') {
    query = query.eq('status', opts.status);
  } else if (!opts?.status) {
    query = query.eq('status', 'pending');
  }

  if (opts?.start) query = query.gte('remind_at', opts.start);
  if (opts?.end) query = query.lte('remind_at', opts.end);

  const { data } = await query;
  return data || [];
}
