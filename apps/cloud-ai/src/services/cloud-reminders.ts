import { getSupabaseAdmin } from '../supabase';
import { getExternalAccount, debitCredits } from '../supabase';
import { waSendText } from '../routes/integrations/whatsapp';
import { telnyxSendSms } from '../routes/integrations/telnyx';
import { messagingCreditCost } from '../pricing';
import { WHATSAPP_INTEGRATION_ENABLED } from '../../../../shared/integration-flags';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const REMINDER_POLL_INTERVAL_MS = Number(process.env.REMINDER_POLL_INTERVAL_MS || 30_000); // 30s
const REMINDER_BATCH_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CloudReminder {
  id: string;
  user_id: string;
  title: string;
  message: string | null;
  remind_at: string;
  timezone: string;
  recurrence: RecurrenceRule | null;
  recurrence_count: number;
  delivery_method: 'sms' | 'whatsapp' | 'both';
  status: string;
  attempts: number;
  max_attempts: number;
  // Stable id linking every occurrence of a recurring series (= the local
  // Unified Tasks assignment id). Used to cancel a whole series at once.
  series_id: string | null;
}

interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  days?: number[];
  until?: string;
  count?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reminder Delivery
// ─────────────────────────────────────────────────────────────────────────────

function formatReminderText(reminder: CloudReminder): string {
  const parts = [`Reminder: ${reminder.title}`];
  if (reminder.message && reminder.message !== reminder.title) parts.push(reminder.message);
  return parts.join('\n');
}

async function deliverViaSms(userId: string, text: string): Promise<void> {
  const account = await getExternalAccount(userId, 'telnyx');
  const meta = account?.meta as any;
  if (!meta?.phone || !meta?.verified) {
    throw new Error('No verified Telnyx phone number');
  }
  await telnyxSendSms(meta.phone, text.slice(0, 1600));
  const cost = messagingCreditCost('telnyx');
  if (cost > 0) {
    await debitCredits(userId, {
      sourceType: 'reminder_sms',
      sourceRef: `reminder_sms:${Date.now()}`,
      credits: cost,
    });
  }
}

async function deliverViaWhatsApp(userId: string, text: string): Promise<void> {
  if (!WHATSAPP_INTEGRATION_ENABLED) {
    throw new Error('WhatsApp delivery disabled');
  }
  const account = await getExternalAccount(userId, 'whatsapp');
  const meta = account?.meta as any;
  const waId = meta?.waId || meta?.phone;
  if (!waId) {
    throw new Error('No WhatsApp number linked');
  }
  await waSendText(waId, text.slice(0, 4096));
  const cost = messagingCreditCost('whatsapp');
  if (cost > 0) {
    await debitCredits(userId, {
      sourceType: 'reminder_whatsapp',
      sourceRef: `reminder_wa:${Date.now()}`,
      credits: cost,
    });
  }
}

async function deliverReminder(reminder: CloudReminder): Promise<void> {
  const text = formatReminderText(reminder);

  if (reminder.delivery_method === 'sms') {
    await deliverViaSms(reminder.user_id, text);
  } else if (reminder.delivery_method === 'whatsapp') {
    if (!WHATSAPP_INTEGRATION_ENABLED) {
      throw new Error('WhatsApp delivery disabled');
    }
    await deliverViaWhatsApp(reminder.user_id, text);
  } else if (reminder.delivery_method === 'both') {
    // Send both — if one fails, try the other, throw only if both fail
    const errors: string[] = [];
    try { await deliverViaSms(reminder.user_id, text); } catch (e: any) { errors.push(`sms: ${e?.message}`); }
    if (WHATSAPP_INTEGRATION_ENABLED) {
      try { await deliverViaWhatsApp(reminder.user_id, text); } catch (e: any) { errors.push(`wa: ${e?.message}`); }
    }
    if (errors.length === (WHATSAPP_INTEGRATION_ENABLED ? 2 : 1)) throw new Error(errors.join('; '));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recurrence: schedule next occurrence
// ─────────────────────────────────────────────────────────────────────────────

function computeNextOccurrence(remindAt: string, rule: RecurrenceRule, occurrenceCount: number): Date | null {
  if (rule.count && occurrenceCount >= rule.count) return null;

  const base = new Date(remindAt);
  const interval = rule.interval || 1;
  let next: Date;

  switch (rule.frequency) {
    case 'daily':
      next = new Date(base);
      next.setDate(next.getDate() + interval);
      break;
    case 'weekly':
      next = new Date(base);
      next.setDate(next.getDate() + 7 * interval);
      break;
    case 'monthly':
      next = new Date(base);
      next.setMonth(next.getMonth() + interval);
      break;
    case 'yearly':
      next = new Date(base);
      next.setFullYear(next.getFullYear() + interval);
      break;
    default:
      return null;
  }

  if (rule.until) {
    const until = new Date(rule.until);
    if (next > until) return null;
  }

  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Poll Cycle
// ─────────────────────────────────────────────────────────────────────────────

async function processDueReminders(): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  // Claim due reminders atomically
  const { data: reminders, error } = await supabase.rpc('claim_due_reminders', {
    p_limit: REMINDER_BATCH_SIZE,
  });

  if (error || !reminders || !Array.isArray(reminders) || reminders.length === 0) return;

  console.log(`[reminders] Processing ${reminders.length} due reminder(s)`);

  for (const reminder of reminders as CloudReminder[]) {
    try {
      await deliverReminder(reminder);

      // Mark as sent
      await supabase.rpc('complete_reminder', { p_id: reminder.id });

      // If recurring, schedule the next occurrence
      if (reminder.recurrence) {
        const nextDate = computeNextOccurrence(
          reminder.remind_at,
          reminder.recurrence,
          reminder.recurrence_count + 1,
        );
        if (nextDate) {
          await supabase.from('cloud_reminders').insert({
            user_id: reminder.user_id,
            title: reminder.title,
            message: reminder.message,
            remind_at: nextDate.toISOString(),
            timezone: reminder.timezone,
            recurrence: reminder.recurrence,
            recurrence_count: reminder.recurrence_count + 1,
            delivery_method: reminder.delivery_method,
            // Carry the series handle forward so the whole series stays
            // cancelable via (user_id, series_id).
            series_id: reminder.series_id,
          });
        }
      }

      console.log(`[reminders] Delivered reminder ${reminder.id} to user ${reminder.user_id} via ${reminder.delivery_method}`);
    } catch (err: any) {
      console.error(`[reminders] Failed to deliver reminder ${reminder.id}:`, err?.message);
      try {
        await supabase.rpc('fail_reminder', {
          p_id: reminder.id,
          p_error: String(err?.message || 'delivery_failed').slice(0, 1000),
        });
      } catch { /* ignore fail_reminder errors */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

let reminderInterval: ReturnType<typeof setInterval> | null = null;

export function startReminderCron(): void {
  if (reminderInterval) return;
  console.log(`[reminders] Starting cloud reminder cron (interval: ${REMINDER_POLL_INTERVAL_MS}ms)`);

  // Immediately process any overdue reminders (catches up after server downtime)
  processDueReminders().catch((err) => {
    console.error('[reminders] Initial catch-up cycle error:', err?.message || err);
  });

  reminderInterval = setInterval(() => {
    processDueReminders().catch((err) => {
      console.error('[reminders] Poll cycle error:', err?.message || err);
    });
  }, REMINDER_POLL_INTERVAL_MS);
  if (reminderInterval.unref) reminderInterval.unref();
}

export function stopReminderCron(): void {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
    console.log('[reminders] Reminder cron stopped');
  }
}
