import type { IncomingMessage, ServerResponse } from 'http';

import { requireAuth, getUserId, sendJson } from '../../auth/http';
import { claimTokens } from './oauth-claim-store';

/**
 * GET /integrations/oauth/claim
 *
 * One-time pickup of OAuth tokens that an OAuth callback staged for this user.
 * Authenticated with the user's Bearer JWT (header only — never query param);
 * tokens are bound to and returned only for the authenticated userId, then
 * deleted from the staging store. The desktop calls this right after a connect
 * completes and writes the result into its encrypted local store.
 *
 * Provider-agnostic so it serves every integration, not just Google.
 */
export async function handleOAuthClaimRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  if (req.method !== 'GET' || parsedUrl.pathname !== '/integrations/oauth/claim') {
    return false;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return true; // requireAuth already sent the error response

  const userId = getUserId(auth);
  const tokens = claimTokens(userId);
  sendJson(res, 200, { ok: true, tokens });
  return true;
}
