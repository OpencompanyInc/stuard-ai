import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getProfile, getMonthlyUsageCredits } from '../supabase';
import { monthlyCreditLimitForPlan, creditsPerUsd } from '../pricing';

export async function handleCredits(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (req.method === 'GET' && (req.url || '') === '/v1/credits') {
    try {
      const auth = String(req.headers['authorization'] || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authUser = token ? await verifyToken(token) : null;
      if (!authUser) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
        return true;
      }
      const profile = await getProfile(authUser.userId);
      const plan = (profile?.plan || 'free').toString();
      const limit = monthlyCreditLimitForPlan(plan);
      const used = await getMonthlyUsageCredits(authUser.userId);
      const unlimited = limit < 0;
      const remaining = unlimited ? -1 : Math.max(0, (limit || 0) - (used || 0));
      const body = JSON.stringify({ ok: true, plan, limit, used, remaining, unlimited, creditsPerUsd: creditsPerUsd() });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }
  return false;
}
