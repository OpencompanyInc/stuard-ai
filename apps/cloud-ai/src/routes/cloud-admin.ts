/**
 * Cloud Admin API Routes (Ops Console)
 * 
 * Aggregate-only endpoints. No personal user data exposed.
 * Uses existing requireAdmin() pattern from ops.ts.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getSupabaseService, getCloudEngineSummary, getTotalBilling, getAggregateMetrics } from '../supabase';
import { getAllHealthStatuses } from '../services/vm-health';

function json(res: ServerResponse, status: number, body: any): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

async function requireAdmin(req: IncomingMessage): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return { ok: false, error: 'unauthorized' };
  const token = authHeader.slice(7);
  const user = await verifyToken(token);
  if (!user?.email) return { ok: false, error: 'unauthorized' };
  const email = user.email.toLowerCase();
  const supabase = getSupabaseService();
  if (!supabase) return { ok: false, error: 'service_unavailable' };
  const { data } = await supabase.from('beta_users').select('access_level').eq('email', email).single();
  if (data?.access_level !== 'all') return { ok: false, error: 'forbidden' };
  return { ok: true, email };
}

export async function handleCloudAdminRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = parsedUrl.pathname;
  const method = req.method || '';

  if (!path.startsWith('/v1/ops/cloud-')) return false;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  if (method !== 'GET') return false;

  const auth = await requireAdmin(req);
  if (!auth.ok) {
    json(res, auth.error === 'forbidden' ? 403 : 401, { ok: false, error: auth.error });
    return true;
  }

  // GET /v1/ops/cloud-summary — Aggregate stats: total VMs, running/stopped counts
  if (path === '/v1/ops/cloud-summary') {
    try {
      const summary = await getCloudEngineSummary();
      json(res, 200, { ok: true, ...summary });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'internal_error' });
    }
    return true;
  }

  // GET /v1/ops/cloud-health — System-wide health: healthy/unhealthy/unreachable counts, avg CPU/RAM
  if (path === '/v1/ops/cloud-health') {
    try {
      const summary = await getCloudEngineSummary();
      const metrics = await getAggregateMetrics();
      json(res, 200, {
        ok: true,
        healthy: summary.healthy,
        unhealthy: summary.unhealthy,
        unreachable: summary.unreachable,
        avgCpu: metrics.avg_cpu,
        avgMemory: metrics.avg_memory,
        totalDiskGb: metrics.total_disk_gb,
      });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'internal_error' });
    }
    return true;
  }

  // GET /v1/ops/cloud-billing — Total billing this month
  if (path === '/v1/ops/cloud-billing') {
    try {
      const billing = await getTotalBilling();
      json(res, 200, { ok: true, ...billing });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'internal_error' });
    }
    return true;
  }

  return false;
}
