import { IncomingMessage, ServerResponse } from 'http';
import { json, readBody, getAuth, getSupabaseService } from './utils';

export async function handleSyncSpace(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) {
    json(res, { ok: false, error: 'Database not configured' }, 503);
    return;
  }

  const auth = await getAuth(req);
  if (!auth) {
    json(res, { ok: false, error: 'unauthorized' }, 401);
    return;
  }

  const body = await readBody(req);
  const { 
    local_space_id,
    name_encrypted,
    description_encrypted,
    type,
    icon,
    color,
    items_encrypted,
    checksum,
  } = body;

  if (!local_space_id || !name_encrypted || !type || !checksum) {
    json(res, { ok: false, error: 'missing_required_fields' }, 400);
    return;
  }

  try {
    // Upsert the shared space
    const { data, error } = await supabase
      .from('shared_spaces')
      .upsert({
        owner_id: auth.userId,
        local_space_id,
        name_encrypted,
        description_encrypted: description_encrypted || null,
        type,
        icon: icon || '📁',
        color: color || '#6366f1',
        items_encrypted: items_encrypted || null,
        checksum,
        synced_at: new Date().toISOString(),
      }, { 
        onConflict: 'owner_id,local_space_id',
      })
      .select('id, local_space_id, synced_at')
      .single();

    if (error) {
      console.error('[shared-spaces] sync error:', error);
      json(res, { ok: false, error: error.message }, 500);
      return;
    }

    json(res, { 
      ok: true, 
      shared_space_id: data.id,
      local_space_id: data.local_space_id,
      synced_at: data.synced_at,
    });
  } catch (error) {
    console.error('[shared-spaces] sync exception:', error);
    json(res, { ok: false, error: String(error) }, 500);
  }
}
