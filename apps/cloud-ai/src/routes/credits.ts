import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getCreditSummary, getUsageBreakdown, getCreditTransactions } from '../supabase';
import { creditsPerUsd } from '../pricing';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
} as const;

function writeJson(res: ServerResponse, status: number, data: any): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function authenticateRequest(req: IncomingMessage): Promise<{ userId: string; email?: string } | null> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return token ? verifyToken(token) : null;
}

export async function handleCredits(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (req.method !== 'GET') return false;
  const path = parsedUrl.pathname;

  // GET /v1/credits — credit summary
  if (path === '/v1/credits') {
    try {
      const authUser = await authenticateRequest(req);
      if (!authUser) { writeJson(res, 401, { ok: false, error: 'unauthorized' }); return true; }
      const summary = await getCreditSummary(authUser.userId);
      writeJson(res, 200, { ok: true, ...summary, creditsPerUsd: creditsPerUsd() });
      return true;
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: 'internal_error', message: e?.message || 'failed' });
      return true;
    }
  }

  // GET /v1/credits/usage — usage breakdown by category
  if (path === '/v1/credits/usage') {
    try {
      const authUser = await authenticateRequest(req);
      if (!authUser) { writeJson(res, 401, { ok: false, error: 'unauthorized' }); return true; }

      const sinceParam = parsedUrl.searchParams.get('since');
      const since = sinceParam ? new Date(sinceParam) : undefined;
      const breakdown = await getUsageBreakdown(authUser.userId, since);
      const totalCredits = breakdown.reduce((sum, b) => sum + b.credits, 0);
      const totalCostUsd = breakdown.reduce((sum, b) => sum + b.costUsd, 0);

      writeJson(res, 200, {
        ok: true,
        breakdown,
        totalCredits: Number(totalCredits.toFixed(2)),
        totalCostUsd: Number(totalCostUsd.toFixed(4)),
      });
      return true;
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: 'internal_error', message: e?.message || 'failed' });
      return true;
    }
  }

  // GET /v1/credits/transactions — recent transaction history
  if (path === '/v1/credits/transactions') {
    try {
      const authUser = await authenticateRequest(req);
      if (!authUser) { writeJson(res, 401, { ok: false, error: 'unauthorized' }); return true; }

      const limit = Math.min(100, Math.max(1, Number(parsedUrl.searchParams.get('limit')) || 50));
      const offset = Math.max(0, Number(parsedUrl.searchParams.get('offset')) || 0);
      const result = await getCreditTransactions(authUser.userId, limit, offset);

      writeJson(res, 200, { ok: true, ...result });
      return true;
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: 'internal_error', message: e?.message || 'failed' });
      return true;
    }
  }

  return false;
}
