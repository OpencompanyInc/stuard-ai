import { IncomingMessage, ServerResponse } from 'http';
import { handleSyncSpace } from './sync';
import { handleListMySpaces, handleListSharedWithMe } from './list';
import { handleGetSpace } from './get';
import { handleDeleteSpace, handleRevokeShare } from './delete';
import { handleShareSpace, handleListShares, handleAcceptShare } from './share';
import { getSupabaseService, json } from './utils';

export async function handleSharedSpacesRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method || 'GET';
  const supabase = getSupabaseService();

  if (!supabase) {
    json(res, { ok: false, error: 'Database not configured' }, 503);
    return true;
  }

  // SYNC SPACE TO CLOUD
  if (path === '/v1/shared-spaces/sync' && method === 'POST') {
    await handleSyncSpace(req, res);
    return true;
  }

  // LIST SPACES SHARED WITH ME
  if (path === '/v1/shared-spaces/shared-with-me' && method === 'GET') {
    await handleListSharedWithMe(req, res);
    return true;
  }

  // LIST MY SYNCED SPACES
  if (path === '/v1/shared-spaces' && method === 'GET') {
    await handleListMySpaces(req, res);
    return true;
  }

  // GET SHARED SPACE DATA (for download/restore)
  if (path.match(/^\/v1\/shared-spaces\/[^/]+$/) && method === 'GET') {
    const spaceId = path.split('/v1/shared-spaces/')[1];
    await handleGetSpace(req, res, spaceId);
    return true;
  }

  // DELETE SYNCED SPACE
  if (path.match(/^\/v1\/shared-spaces\/[^/]+$/) && method === 'DELETE') {
    const spaceId = path.split('/v1/shared-spaces/')[1];
    await handleDeleteSpace(req, res, spaceId);
    return true;
  }

  // SHARE SPACE WITH EMAIL
  if (path.match(/^\/v1\/shared-spaces\/[^/]+\/share$/) && method === 'POST') {
    const spaceId = path.split('/v1/shared-spaces/')[1].replace('/share', '');
    await handleShareSpace(req, res, spaceId);
    return true;
  }

  // LIST SHARES FOR A SPACE
  if (path.match(/^\/v1\/shared-spaces\/[^/]+\/shares$/) && method === 'GET') {
    const spaceId = path.split('/v1/shared-spaces/')[1].replace('/shares', '');
    await handleListShares(req, res, spaceId);
    return true;
  }

  // REVOKE A SHARE
  if (path.match(/^\/v1\/shared-spaces\/[^/]+\/shares\/[^/]+$/) && method === 'DELETE') {
    const parts = path.split('/');
    const spaceId = parts[3];
    const shareId = parts[5];
    await handleRevokeShare(req, res, spaceId, shareId);
    return true;
  }

  // ACCEPT A SHARE
  if (path.match(/^\/v1\/shared-spaces\/accept\/[^/]+$/) && method === 'POST') {
    const shareId = path.split('/v1/shared-spaces/accept/')[1];
    await handleAcceptShare(req, res, shareId);
    return true;
  }

  return false;
}

