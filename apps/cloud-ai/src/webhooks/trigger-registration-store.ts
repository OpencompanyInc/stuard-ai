/**
 * Durable store for native trigger registrations.
 *
 * social-triggers.ts and google-native-triggers.ts keep registrations in
 * in-memory maps for fast webhook fan-out. Those maps are wiped on every
 * Cloud Run restart/redeploy, which used to silently kill all live triggers.
 * This module write-throughs each registration (including mutable state like
 * Gmail history cursors and Drive channel ids) to the `trigger_registrations`
 * table so the maps can be rebuilt on boot via the restore functions in the
 * owning modules.
 *
 * Everything here is best-effort: if Supabase is unavailable the in-memory
 * registries still work for the lifetime of the process.
 */
import { getSupabaseService } from '../supabase';
import { writeLog } from '../utils/logger';

export type TriggerRegistrationKind = 'social' | 'gmail' | 'drive';

export interface PersistedTriggerRegistration {
  kind: TriggerRegistrationKind;
  key: string;
  userId: string;
  workflowId: string;
  triggerId: string;
  type: string;
  /** Full registration record (sourceKeys, args, cursors, channel info, …). */
  data: Record<string, any>;
}

export async function persistTriggerRegistration(reg: PersistedTriggerRegistration): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('trigger_registrations')
      .upsert({
        kind: reg.kind,
        key: reg.key,
        user_id: reg.userId,
        workflow_id: reg.workflowId,
        trigger_id: reg.triggerId,
        type: reg.type,
        data: reg.data || {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'kind,key' });
    if (error) {
      writeLog('trigger_registration_persist_failed', { kind: reg.kind, key: reg.key, error: error.message });
    }
  } catch (e: any) {
    writeLog('trigger_registration_persist_failed', { kind: reg.kind, key: reg.key, error: String(e?.message || e) });
  }
}

export async function deleteTriggerRegistration(kind: TriggerRegistrationKind, key: string): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('trigger_registrations')
      .delete()
      .eq('kind', kind)
      .eq('key', key);
    if (error) {
      writeLog('trigger_registration_delete_failed', { kind, key, error: error.message });
    }
  } catch (e: any) {
    writeLog('trigger_registration_delete_failed', { kind, key, error: String(e?.message || e) });
  }
}

export async function loadTriggerRegistrations(kind: TriggerRegistrationKind): Promise<PersistedTriggerRegistration[]> {
  const supabase = getSupabaseService();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('trigger_registrations')
      .select('kind, key, user_id, workflow_id, trigger_id, type, data')
      .eq('kind', kind);
    if (error) {
      writeLog('trigger_registration_load_failed', { kind, error: error.message });
      return [];
    }
    return (data || []).map((row: any) => ({
      kind,
      key: String(row.key || ''),
      userId: String(row.user_id || ''),
      workflowId: String(row.workflow_id || ''),
      triggerId: String(row.trigger_id || ''),
      type: String(row.type || ''),
      data: row.data && typeof row.data === 'object' ? row.data : {},
    })).filter((r: PersistedTriggerRegistration) => r.key && r.userId);
  } catch (e: any) {
    writeLog('trigger_registration_load_failed', { kind, error: String(e?.message || e) });
    return [];
  }
}
