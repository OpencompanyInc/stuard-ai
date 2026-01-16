import { IncomingMessage, ServerResponse } from 'http';
import { json, getAuth, getSupabaseService } from './utils';

export async function handleDeleteSpace(req: IncomingMessage, res: ServerResponse, spaceId: string): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return json(res, { ok: false, error: 'Database not configured' }, 503);

  const auth = await getAuth(req);
  if (!auth) return json(res, { ok: false, error: 'unauthorized' }, 401);

  try {
    const { error } = await supabase
      .from('shared_spaces')
      .delete()
      .eq('id', spaceId)
      .eq('owner_id', auth.userId);

    if (error) {
      json(res, { ok: false, error: error.message }, 500);
      return;
    }

    json(res, { ok: true, deleted: true });
  } catch (error) {
    json(res, { ok: false, error: String(error) }, 500);
  }
}

export async function handleRevokeShare(req: IncomingMessage, res: ServerResponse, spaceId: string, shareId: string): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return json(res, { ok: false, error: 'Database not configured' }, 503);

  const auth = await getAuth(req);
  if (!auth) return json(res, { ok: false, error: 'unauthorized' }, 401);

  try {
    // Verify ownership of the space
    const { data: space } = await supabase
      .from('shared_spaces')
      .select('id')
      .eq('id', spaceId)
      .eq('owner_id', auth.userId)
      .single();

    if (!space) {
      json(res, { ok: false, error: 'not_found_or_not_owner' }, 404);
      return;
    }

    const { error } = await supabase
      .from('space_shares')
      .delete()
      .eq('id', shareId)
      .eq('shared_space_id', spaceId);

    if (error) {
      json(res, { ok: false, error: error.message }, 500);
      return;
    }

    json(res, { ok: true, revoked: true });
  } catch (error) {
    json(res, { ok: false, error: String(error) }, 500);
  }
}
