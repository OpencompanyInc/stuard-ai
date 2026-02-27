/**
 * Cloud Monitoring API Routes
 * 
 * VM metrics and health status endpoints.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getMetricsHistory } from '../supabase';
import { getLatestMetrics, getHealthStatus } from '../services/vm-health';
import { sendVMCommand } from '../services/vm-command';

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

async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<{ userId: string } | null> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = token ? await verifyToken(token) : null;
  if (!user) { json(res, 401, { ok: false, error: 'unauthorized' }); return null; }
  return user;
}

export async function handleCloudMonitoringRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = parsedUrl.pathname;
  const method = req.method || '';

  if (!path.startsWith('/v1/cloud-engine/metrics') && path !== '/v1/cloud-engine/health') return false;

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

  const user = await authenticate(req, res);
  if (!user) return true;

  // GET /v1/cloud-engine/metrics — Latest metrics from health monitor, falls back to live VM query
  if (path === '/v1/cloud-engine/metrics') {
    let metrics = getLatestMetrics(user.userId);

    // If the health monitor hasn't cached metrics yet, fetch live from VM
    if (!metrics) {
      try {
        const vmResult = await sendVMCommand(user.userId, 'metrics', {});
        if (vmResult.ok && vmResult.result) {
          const m = vmResult.result;
          metrics = {
            cpu: m.cpu_percent ?? 0,
            ram_used: (m.memory_used_mb ?? 0) * 1024 * 1024,
            ram_total: (m.memory_total_mb ?? 0) * 1024 * 1024,
            disk_used: (m.disk_used_gb ?? 0) * 1024 * 1024 * 1024,
            disk_total: (m.disk_total_gb ?? 0) * 1024 * 1024 * 1024,
            net_rx: m.network_rx_bytes ?? 0,
            net_tx: m.network_tx_bytes ?? 0,
          };
        }
      } catch { /* non-fatal — return null */ }
    }

    json(res, 200, { ok: true, metrics: metrics || null });
    return true;
  }

  // GET /v1/cloud-engine/metrics/history?hours=24
  if (path === '/v1/cloud-engine/metrics/history') {
    const hours = Math.min(Math.max(Number(parsedUrl.searchParams.get('hours')) || 24, 1), 168); // max 7 days
    const history = await getMetricsHistory(user.userId, hours);
    json(res, 200, { ok: true, history, hours });
    return true;
  }

  // GET /v1/cloud-engine/health
  if (path === '/v1/cloud-engine/health') {
    const health = getHealthStatus(user.userId);
    json(res, 200, {
      ok: true,
      health: health ? {
        status: health.healthStatus,
        lastHeartbeat: health.lastPing ? new Date(health.lastPing).toISOString() : null,
        agentVersion: health.agentVersion,
      } : null,
    });
    return true;
  }

  return false;
}
