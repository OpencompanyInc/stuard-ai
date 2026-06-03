/**
 * Cloud Deploy API Routes
 *
 * Deploy workflows and projects to Cloud VMs.
 *
 * Endpoints:
 *   POST   /v1/cloud-engine/deploys              — Create deployment
 *   GET    /v1/cloud-engine/deploys              — List deployments
 *   GET    /v1/cloud-engine/deploys/:id          — Get deployment
 *   POST   /v1/cloud-engine/deploys/:id/stop     — Stop deployment
 *   POST   /v1/cloud-engine/deploys/:id/restart  — Restart deployment
 *   GET    /v1/cloud-engine/deploys/:id/logs     — Stream logs
 *   DELETE /v1/cloud-engine/deploys/:id          — Delete deployment
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getCloudEngine } from '../supabase';
import { verifyVMAuthFromRequest } from '../services/vm-tokens';
import { sendVMCommand } from '../services/vm-command';
import {
  createDeployment,
  DeploymentValidationError,
  listDeployments,
  getDeployment,
  stopDeployment,
  restartDeployment,
  deleteDeployment,
  getDeployLogs,
  updateDeployStatus,
} from '../services/deploy-manager';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

async function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<{ userId: string } | null> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = token ? await verifyToken(token) : null;
  if (!user) { json(res, 401, { ok: false, error: 'unauthorized' }); return null; }
  return user;
}

const VALID_KINDS = ['workflow', 'project'];

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCloudDeploysRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = parsedUrl.pathname;
  const method = req.method || '';

  if (!path.startsWith('/v1/cloud-engine/deploys')) return false;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-VM-User-Id',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  // ── POST /v1/cloud-engine/deploys/status-callback — VM reports deploy status
  // Uses VM HMAC auth (no user JWT on VM)
  if (method === 'POST' && path === '/v1/cloud-engine/deploys/status-callback') {
    const authHeader = String(req.headers['authorization'] || '');
    const vmUserIdHeader = req.headers['x-vm-user-id'] as string | undefined;
    const vmUser = await verifyVMAuthFromRequest(authHeader, vmUserIdHeader);

    if (!vmUser) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }

    try {
      const body = await readBody(req);
      const deployId = String(body.deployId || '').trim();
      const status = String(body.status || '').trim();

      if (!deployId || !['completed', 'failed', 'stopped'].includes(status)) {
        json(res, 400, { ok: false, error: 'invalid_payload', message: 'deployId and status (completed|failed|stopped) are required' });
        return true;
      }

      const extra: any = {};
      if (status === 'completed' || status === 'stopped') {
        extra.stopped_at = new Date().toISOString();
      }
      if (body.errorMessage) {
        extra.error_message = String(body.errorMessage).slice(0, 2000);
      }

      await updateDeployStatus(deployId, status as any, extra);
      json(res, 200, { ok: true });
    } catch (e: any) {
      console.error('[cloud-deploys] status-callback error:', e?.message);
      json(res, 500, { ok: false, error: 'status_update_failed', message: e?.message });
    }
    return true;
  }

  const user = await authenticate(req, res);
  if (!user) return true;

  // Ensure user has a running engine
  const engine = await getCloudEngine(user.userId);
  if (!engine || engine.status !== 'running') {
    json(res, 409, { ok: false, error: 'engine_not_running', message: 'Cloud Engine must be running to manage deployments' });
    return true;
  }

  // ── POST /v1/cloud-engine/deploys — Create new deployment ────────────────
  if (method === 'POST' && path === '/v1/cloud-engine/deploys') {
    try {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const kind = String(body.kind || 'workflow').toLowerCase();

      if (!name) {
        json(res, 400, { ok: false, error: 'name_required' });
        return true;
      }
      if (!VALID_KINDS.includes(kind)) {
        json(res, 400, { ok: false, error: 'invalid_kind', validKinds: VALID_KINDS });
        return true;
      }
      if (!body.payload) {
        json(res, 400, { ok: false, error: 'payload_required', message: 'Workflow JSON or project manifest is required' });
        return true;
      }

      const deployment = await createDeployment(user.userId, {
        name,
        kind: kind as any,
        description: body.description,
        payload: body.payload,
        envVars: body.envVars,
        autoRestart: body.autoRestart,
        schedule: body.schedule,
        workflowId: body.workflowId,
        triggerBindings: body.triggerBindings,
      });

      json(res, 201, { ok: true, deployment });
    } catch (e: any) {
      if (e instanceof DeploymentValidationError) {
        json(res, 400, {
          ok: false,
          error: 'deployment_validation_failed',
          message: e.message,
          issues: e.issues,
        });
        return true;
      }
      console.error('[cloud-deploys] create error:', e?.message);
      json(res, 500, { ok: false, error: 'deploy_failed', message: e?.message || 'Deployment failed' });
    }
    return true;
  }

  // ── GET /v1/cloud-engine/deploys — List all deployments ──────────────────
  if (method === 'GET' && path === '/v1/cloud-engine/deploys') {
    try {
      const deployments = await listDeployments(user.userId);
      let vmDeploys: any[] = [];
      try {
        const vmResult = await sendVMCommand(user.userId, 'deploy_list', {}, 8_000);
        if (vmResult.ok && Array.isArray(vmResult.result?.deploys)) {
          vmDeploys = vmResult.result.deploys;
        }
      } catch { /* VM runtime details are best-effort */ }

      const vmById = new Map(vmDeploys.map((deploy: any) => [String(deploy.id || deploy.deployId || ''), deploy]));
      const merged = deployments.map((deployment: any) => {
        const runtime = vmById.get(String(deployment.id));
        if (!runtime) return deployment;
        return {
          ...deployment,
          status: runtime.status || deployment.status,
          pid: runtime.pid ?? deployment.pid ?? null,
          trigger_bindings: runtime.trigger_bindings || deployment.trigger_bindings || [],
          schedule: runtime.schedule ?? deployment.schedule ?? null,
          timezone: runtime.timezone ?? null,
          run_count: runtime.run_count ?? 0,
          last_run_at: runtime.last_run_at ?? null,
          last_completed_at: runtime.last_completed_at ?? null,
          last_trigger_source: runtime.last_trigger_source ?? null,
        };
      });

      json(res, 200, { ok: true, deployments: merged });
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'list_failed', message: e?.message });
    }
    return true;
  }

  // ── Extract deploy ID from path ──────────────────────────────────────────
  const idMatch = path.match(/^\/v1\/cloud-engine\/deploys\/([a-f0-9-]+?)(?:\/|$)/);
  if (!idMatch) return false;
  const deployId = idMatch[1];

  // ── GET /v1/cloud-engine/deploys/:id — Get deployment details ────────────
  if (method === 'GET' && path === `/v1/cloud-engine/deploys/${deployId}`) {
    try {
      const deployment = await getDeployment(user.userId, deployId);
      if (!deployment) {
        json(res, 404, { ok: false, error: 'not_found' });
        return true;
      }
      json(res, 200, { ok: true, deployment });
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'get_failed', message: e?.message });
    }
    return true;
  }

  // ── GET /v1/cloud-engine/deploys/:id/logs — Get deployment logs ──────────
  if (method === 'GET' && path === `/v1/cloud-engine/deploys/${deployId}/logs`) {
    try {
      const lines = Number(parsedUrl.searchParams.get('lines') || 200);
      const result = await getDeployLogs(user.userId, deployId, lines);
      if (!result.ok) {
        json(res, 500, { ok: false, error: result.error || 'logs_unavailable' });
        return true;
      }
      json(res, 200, { ok: true, logs: result.logs });
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'logs_failed', message: e?.message });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/deploys/:id/stop — Stop deployment ─────────────
  if (method === 'POST' && path === `/v1/cloud-engine/deploys/${deployId}/stop`) {
    try {
      const result = await stopDeployment(user.userId, deployId);
      if (!result.success) {
        json(res, 400, { ok: false, error: result.error });
        return true;
      }
      json(res, 200, { ok: true, message: 'Deployment stopped' });
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'stop_failed', message: e?.message });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/deploys/:id/restart — Restart deployment ───────
  if (method === 'POST' && path === `/v1/cloud-engine/deploys/${deployId}/restart`) {
    try {
      const result = await restartDeployment(user.userId, deployId);
      if (!result.success) {
        json(res, 400, { ok: false, error: result.error });
        return true;
      }
      json(res, 200, { ok: true, message: 'Deployment restarted' });
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'restart_failed', message: e?.message });
    }
    return true;
  }

  // ── DELETE /v1/cloud-engine/deploys/:id — Delete deployment ──────────────
  if (method === 'DELETE' && path === `/v1/cloud-engine/deploys/${deployId}`) {
    try {
      const result = await deleteDeployment(user.userId, deployId);
      if (!result.success) {
        json(res, 400, { ok: false, error: result.error });
        return true;
      }
      json(res, 200, { ok: true, message: 'Deployment deleted' });
    } catch (e: any) {
      json(res, 500, { ok: false, error: 'delete_failed', message: e?.message });
    }
    return true;
  }

  return false;
}
