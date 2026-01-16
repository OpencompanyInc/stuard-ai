import { IncomingMessage, ServerResponse } from 'http';
import { json, getAuth, getSupabaseService } from './utils';

export async function handleGetSpace(req: IncomingMessage, res: ServerResponse, spaceId: string): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return json(res, { ok: false, error: 'Database not configured' }, 503);

  const auth = await getAuth(req);
  if (!auth) return json(res, { ok: false, error: 'unauthorized' }, 401);

  try {
    // First check if user owns it
    let { data, error } = await supabase
      .from('shared_spaces')
      .select('*')
      .eq('id', spaceId)
      .eq('owner_id', auth.userId)
      .single();

    // If not owner, check if it's shared with them
    if (error || !data) {
      const { data: shareData } = await supabase
        .from('space_shares')
        .select('shared_space_id')
        .eq('shared_space_id', spaceId)
        .eq('shared_with_user_id', auth.userId)
        .not('accepted_at', 'is', null)
        .single();

      if (shareData) {
        const { data: sharedSpace } = await supabase
          .from('shared_spaces')
          .select('*')
          .eq('id', spaceId)
          .single();
        data = sharedSpace;
      }
    }

    if (!data) {
      json(res, { ok: false, error: 'not_found' }, 404);
      return;
    }

    json(res, { ok: true, space: data });
  } catch (error) {
    json(res, { ok: false, error: String(error) }, 500);
  }
}
