import { IncomingMessage, ServerResponse } from 'http';
import { json, readBody, getAuth, getSupabaseService } from './utils';

export async function handleShareSpace(req: IncomingMessage, res: ServerResponse, spaceId: string): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return json(res, { ok: false, error: 'Database not configured' }, 503);

  const auth = await getAuth(req);
  if (!auth) return json(res, { ok: false, error: 'unauthorized' }, 401);

  const body = await readBody(req);
  const { email, permission, share_key_encrypted, expires_at } = body;

  if (!email) {
    json(res, { ok: false, error: 'missing_email' }, 400);
    return;
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    json(res, { ok: false, error: 'invalid_email' }, 400);
    return;
  }

  try {
    // Verify ownership
    const { data: space, error: spaceError } = await supabase
      .from('shared_spaces')
      .select('id, owner_id')
      .eq('id', spaceId)
      .eq('owner_id', auth.userId)
      .single();

    if (spaceError || !space) {
      json(res, { ok: false, error: 'space_not_found_or_not_owner' }, 404);
      return;
    }

    // Create the share
    const { data: share, error: shareError } = await supabase
      .from('space_shares')
      .upsert({
        shared_space_id: spaceId,
        shared_with_email: email.toLowerCase().trim(),
        shared_with_user_id: null, // Will be resolved on login/accept
        permission: permission || 'read',
        share_key_encrypted: share_key_encrypted || null,
        expires_at: expires_at || null,
      }, {
        onConflict: 'shared_space_id,shared_with_email',
      })
      .select('id, shared_with_email, permission, created_at')
      .single();

    if (shareError) {
      console.error('[shared-spaces] share error:', shareError);
      json(res, { ok: false, error: shareError.message }, 500);
      return;
    }

    json(res, { ok: true, share });
  } catch (error) {
    console.error('[shared-spaces] share exception:', error);
    json(res, { ok: false, error: String(error) }, 500);
  }
}

export async function handleListShares(req: IncomingMessage, res: ServerResponse, spaceId: string): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return json(res, { ok: false, error: 'Database not configured' }, 503);

  const auth = await getAuth(req);
  if (!auth) return json(res, { ok: false, error: 'unauthorized' }, 401);

  try {
    // Verify ownership
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

    const { data: shares, error } = await supabase
      .from('space_shares')
      .select('id, shared_with_email, permission, accepted_at, created_at, expires_at')
      .eq('shared_space_id', spaceId)
      .order('created_at', { ascending: false });

    if (error) {
      json(res, { ok: false, error: error.message }, 500);
      return;
    }

    json(res, { ok: true, shares: shares || [], count: shares?.length || 0 });
  } catch (error) {
    json(res, { ok: false, error: String(error) }, 500);
  }
}

export async function handleAcceptShare(req: IncomingMessage, res: ServerResponse, shareId: string): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return json(res, { ok: false, error: 'Database not configured' }, 503);

  const auth = await getAuth(req);
  if (!auth) return json(res, { ok: false, error: 'unauthorized' }, 401);

  try {
    // Verify the share belongs to this user
    const { data: share, error: findError } = await supabase
      .from('space_shares')
      .select('id, shared_with_email, shared_with_user_id')
      .eq('id', shareId)
      .single();

    if (findError || !share) {
      json(res, { ok: false, error: 'share_not_found' }, 404);
      return;
    }

    // Check if this share is for the current user
    const isForUser = share.shared_with_user_id === auth.userId || 
                      share.shared_with_email === auth.email;

    if (!isForUser) {
      json(res, { ok: false, error: 'not_your_share' }, 403);
      return;
    }

    // Accept the share
    const { error: updateError } = await supabase
      .from('space_shares')
      .update({ 
        accepted_at: new Date().toISOString(),
        shared_with_user_id: auth.userId, // Resolve the user ID
      })
      .eq('id', shareId);

    if (updateError) {
      json(res, { ok: false, error: updateError.message }, 500);
      return;
    }

    json(res, { ok: true, accepted: true });
  } catch (error) {
    json(res, { ok: false, error: String(error) }, 500);
  }
}
