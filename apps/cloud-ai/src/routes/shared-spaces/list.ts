import { IncomingMessage, ServerResponse } from 'http';
import { json, getAuth, getSupabaseService } from './utils';

export async function handleListMySpaces(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return json(res, { ok: false, error: 'Database not configured' }, 503);

  const auth = await getAuth(req);
  if (!auth) return json(res, { ok: false, error: 'unauthorized' }, 401);

  try {
    const { data, error } = await supabase
      .from('shared_spaces')
      .select('id, local_space_id, name_encrypted, type, icon, color, synced_at, created_at')
      .eq('owner_id', auth.userId)
      .order('updated_at', { ascending: false });

    if (error) {
      return json(res, { ok: false, error: error.message }, 500);
    }

    json(res, { ok: true, spaces: data || [], count: data?.length || 0 });
  } catch (error) {
    json(res, { ok: false, error: String(error) }, 500);
  }
}

export async function handleListSharedWithMe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return json(res, { ok: false, error: 'Database not configured' }, 503);

  const auth = await getAuth(req);
  if (!auth) return json(res, { ok: false, error: 'unauthorized' }, 401);

  try {
    // Get shares where user is the recipient
    const { data: shares, error } = await supabase
      .from('space_shares')
      .select(`
        id,
        permission,
        accepted_at,
        created_at,
        expires_at,
        share_key_encrypted,
        shared_spaces (
          id,
          name_encrypted,
          description_encrypted,
          type,
          icon,
          color,
          items_encrypted,
          checksum,
          synced_at,
          owner_id
        )
      `)
      .or(`shared_with_user_id.eq.${auth.userId},shared_with_email.eq.${auth.email || ''}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[shared-spaces] shared-with-me error:', error);
      return json(res, { ok: false, error: error.message }, 500);
    }

    // Filter out expired shares
    const validShares = (shares || []).filter((s: any) => {
      if (!s.expires_at) return true;
      return new Date(s.expires_at) > new Date();
    });

    json(res, { ok: true, shares: validShares, count: validShares.length });
  } catch (error) {
    json(res, { ok: false, error: String(error) }, 500);
  }
}

