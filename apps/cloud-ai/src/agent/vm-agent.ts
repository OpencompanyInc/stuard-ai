/**
 * VM Agent — HTTP Server
 *
 * Lightweight Node.js HTTP service installed on each VM.
 * Cloud-ai sends commands on-demand via HTTP — no persistent WebSocket.
 *
 * Endpoints:
 *   GET  /health          — liveness probe
 *   POST /command          — execute a command (file ops, deploy, shell, snapshot)
 *   POST /terminal/open    — open a PTY session
 *   POST /terminal/data    — write to PTY
 *   POST /terminal/resize  — resize PTY
 *   POST /terminal/close   — close PTY
 *   POST /terminal/read    — poll PTY output buffer
 *   GET  /metrics          — system metrics
 *   POST /sync/upload      — compress workspace → upload to GCS
 *   POST /sync/download    — download from GCS → extract to workspace
 */

import http from 'http';
import { randomUUID } from 'crypto';
import { createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { collectMetrics, initMetrics } from './metrics-collector';
import { ShellExecutor } from './shell-executor';
import { DeployExecutor } from './deploy-executor';
import * as fileManager from './file-manager';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.STUARD_AGENT_PORT || 7400);
const VM_TOKEN = process.env.STUARD_VM_TOKEN || '';
const USER_ID = process.env.STUARD_USER_ID || '';
const AGENT_VERSION = '2.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const shellExecutor = new ShellExecutor();
const deployExecutor = new DeployExecutor();
const LOCAL_AGENT_WS_URL = process.env.STUARD_LOCAL_AGENT_WS || 'ws://127.0.0.1:8765/ws';

// ─────────────────────────────────────────────────────────────────────────────
// Auth — verify HMAC bearer token on each request
//
// Each VM has its own unique secret (VM_TOKEN_SECRET env), generated at
// provisioning and injected via the startup script. Cloud-ai looks up
// this per-VM secret from the database and signs short-lived HMAC tokens.
//
// Compromising one VM's secret cannot forge tokens for any other VM.
// ─────────────────────────────────────────────────────────────────────────────

/** The per-VM HMAC secret (set at provisioning, unique to this VM). */
const VM_SECRET = process.env.VM_TOKEN_SECRET || '';

function verifyBearerToken(authHeader: string | undefined): boolean {
  // Dev mode — no secret configured, accept all requests
  if (!VM_SECRET && !VM_TOKEN) return true;

  const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  // 1. Accept exact match against the provisioned token (backwards compat for startup ping)
  if (VM_TOKEN && token === VM_TOKEN) return true;

  // 2. Verify HMAC-signed token from cloud-ai (format: base64url(payload).base64url(hmac))
  if (!VM_SECRET) return false;

  try {
    const dotIdx = token.indexOf('.');
    if (dotIdx < 1) return false;

    const encodedPayload = token.slice(0, dotIdx);
    const signature = token.slice(dotIdx + 1);

    // Decode and validate payload
    const raw = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const payload = JSON.parse(raw) as { userId?: string; exp?: number; iat?: number; nonce?: string };

    // Verify it's for this user OR a system-level caller (e.g. health monitor)
    const SYSTEM_CALLERS = new Set(['cloud-ai-monitor', 'cloud-ai-system']);
    if (payload.userId !== USER_ID && !SYSTEM_CALLERS.has(payload.userId || '')) return false;

    // Check expiry (tokens are 5 min max)
    if (payload.exp && payload.exp < Date.now()) return false;

    // Verify HMAC signature using this VM's unique secret
    const expectedSig = createHmac('sha256', VM_SECRET).update(encodedPayload).digest('base64url');
    const sigBuf = Buffer.from(signature, 'base64url');
    const expectedBuf = Buffer.from(expectedSig, 'base64url');
    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

function authHeaderFromRequest(req: http.IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (header) return header;
  try {
    const parsed = new URL(req.url || '/', 'http://localhost');
    const token = parsed.searchParams.get('token');
    return token ? `Bearer ${token}` : undefined;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Helpers
// ─────────────────────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, body: any): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

async function uploadArchive(uploadUrl: string, archivePath: string): Promise<void> {
  const stats = fs.statSync(archivePath);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stats.size),
    },
    body: fs.createReadStream(archivePath) as any,
    duplex: 'half' as any,
  });
  if (!response.ok) {
    throw new Error(`gcs_upload_http_${response.status}`);
  }
}

async function downloadArchive(downloadUrl: string, outputPath: string): Promise<number> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`gcs_download_http_${response.status}`);
  }
  if (!response.body) {
    throw new Error('gcs_download_empty_body');
  }
  await pipeline(Readable.fromWeb(response.body as any), fs.createWriteStream(outputPath));
  return fs.statSync(outputPath).size;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function handleCommand(command: string, args: any): Promise<any> {
  switch (command) {
    case 'file_list':
      return await fileManager.listDirectory(args.path || '.');
    case 'file_read':
      return await fileManager.readFile(args.path);
    case 'file_write':
      await fileManager.writeFile(args.path, args.content, args.encoding);
      return { success: true };
    case 'file_delete':
      await fileManager.deleteFile(args.path);
      return { success: true };
    case 'file_rename':
      await fileManager.renameFile(args.oldPath, args.newPath);
      return { success: true };
    case 'file_mkdir':
      await fileManager.mkdirFile(args.path);
      return { success: true };
    case 'file_stat':
      return await fileManager.statFile(args.path);
    case 'metrics':
      return collectMetrics();
    case 'snapshot_create':
      return await createSnapshotArchive(args.path || '/home/stuard');
    case 'snapshot_restore':
      return await restoreSnapshotArchive(args.url, args.path || '/home/stuard');
    case 'ping':
      return { pong: true, timestamp: Date.now(), agentVersion: AGENT_VERSION };

    // ── Deploy Commands ──────────────────────────────────────────────────
    case 'deploy_start':
      return await deployExecutor.start({
        deployId: args.deployId,
        downloadUrl: args.downloadUrl,
        kind: args.kind || 'workflow',
        name: args.name || 'unnamed',
        envVars: args.envVars || {},
        autoRestart: args.autoRestart ?? true,
        schedule: args.schedule || null,
        inlineBundle: args.inlineBundle || undefined,
      });
    case 'deploy_stop':
      return { stopped: deployExecutor.stop(args.deployId) };
    case 'deploy_cleanup':
      return { cleaned: deployExecutor.cleanup(args.deployId) };
    case 'deploy_logs':
      return { logs: deployExecutor.getLogs(args.deployId, args.lines || 200) };
    case 'deploy_list':
      return { deploys: deployExecutor.list() };

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot Helpers (hardened — no shell interpolation)
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_SNAPSHOT_ROOTS = ['/home/stuard', '/opt/stuard'];

function validateSnapshotPath(p: string): string {
  const resolved = require('path').resolve(p);
  if (!ALLOWED_SNAPSHOT_ROOTS.some(root => resolved === root || resolved.startsWith(root + '/'))) {
    throw new Error(`Snapshot path outside allowed roots: ${resolved}`);
  }
  return resolved;
}

async function createSnapshotArchive(targetPath: string): Promise<{ archivePath: string; sizeBytes: number }> {
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const safePath = validateSnapshotPath(targetPath);
  const archivePath = `/tmp/snapshot-${Date.now()}.tar.gz`;
  execFileSync('tar', ['-czf', archivePath, '-C', safePath, '.'], { timeout: 300_000 });
  const stats = fs.statSync(archivePath);
  return { archivePath, sizeBytes: stats.size };
}

async function restoreSnapshotArchive(url: string, targetPath: string): Promise<{ success: boolean }> {
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const safePath = validateSnapshotPath(targetPath);
  const tempPath = `/tmp/restore-${Date.now()}.tar.gz`;

  await new Promise<void>((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const file = fs.createWriteStream(tempPath);
    const req = mod.get(url, (res: any) => {
      if (res.statusCode !== 200) {
        fs.unlinkSync(tempPath);
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.on('error', (e: any) => {
      try { fs.unlinkSync(tempPath); } catch {}
      reject(e);
    });
    req.setTimeout(600_000, () => { req.destroy(); reject(new Error('Download timeout')); });
  });

  execFileSync('tar', ['-xzf', tempPath, '-C', safePath], { timeout: 300_000 });
  try { fs.unlinkSync(tempPath); } catch {}
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // Health probe — no auth required
  if (method === 'GET' && url === '/health') {
    json(res, 200, {
      ok: true,
      agentVersion: AGENT_VERSION,
      userId: USER_ID,
      uptime: Math.round(process.uptime()),
      timestamp: Date.now(),
    });
    return;
  }

  // Auth check for all other endpoints
  if (!verifyBearerToken(req.headers.authorization)) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  // GET /metrics
  if (method === 'GET' && url === '/metrics') {
    try {
      const metrics = collectMetrics();
      json(res, 200, { ok: true, metrics, agentVersion: AGENT_VERSION, activeSessions: shellExecutor.getActiveSessions() });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // POST /command
  if (method === 'POST' && url === '/command') {
    try {
      const body = await readBody(req);
      const command = String(body.command || '');
      const args = body.args || {};
      if (!command) {
        json(res, 400, { ok: false, error: 'missing_command' });
        return;
      }
      const result = await handleCommand(command, args);
      json(res, 200, { ok: true, result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'command_failed' });
    }
    return;
  }

  // ── Terminal endpoints ─────────────────────────────────────────────────

  // POST /terminal/open
  if (method === 'POST' && url === '/terminal/open') {
    try {
      const body = await readBody(req);
      const sessionId = body.sessionId || randomUUID();
      const session = await shellExecutor.create(sessionId, body.cols || 80, body.rows || 24);
      json(res, 200, { ok: true, sessionId, pid: session.pid });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'terminal_open_failed' });
    }
    return;
  }

  // POST /terminal/data  (write input to terminal)
  if (method === 'POST' && url === '/terminal/data') {
    try {
      const body = await readBody(req);
      shellExecutor.write(body.sessionId, body.data);
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // POST /terminal/resize
  if (method === 'POST' && url === '/terminal/resize') {
    try {
      const body = await readBody(req);
      shellExecutor.resize(body.sessionId, body.cols, body.rows);
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // POST /terminal/close
  if (method === 'POST' && url === '/terminal/close') {
    try {
      const body = await readBody(req);
      shellExecutor.destroy(body.sessionId);
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // POST /terminal/read  (poll terminal output buffer)
  if (method === 'POST' && url === '/terminal/read') {
    try {
      const body = await readBody(req);
      const output = shellExecutor.readBuffer(body.sessionId);
      json(res, 200, { ok: true, data: output });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // ── Sync endpoints (hot disk ↔ GCS cold storage) ─────────────────────

  // POST /sync/upload — compress workspace and upload to GCS via signed URL
  if (method === 'POST' && url === '/sync/upload') {
    try {
      const body = await readBody(req);
      const { uploadUrl, objectName } = body;
      if (!uploadUrl) {
        json(res, 400, { ok: false, error: 'missing_upload_url' });
        return;
      }

      const { execFileSync } = require('child_process');
      const workspacePath = process.env.STUARD_WORKSPACE || '/home/stuard';
      const archivePath = `/tmp/sync-upload-${Date.now()}.tar.gz`;

      // Compress workspace
      console.log(`[vm-agent] Compressing workspace ${workspacePath} for sync upload...`);
      execFileSync('tar', ['-czf', archivePath, '-C', workspacePath, '.'], { timeout: 600_000 });
      const stats = fs.statSync(archivePath);
      console.log(`[vm-agent] Archive created: ${stats.size} bytes`);

      // Upload to GCS via signed URL without buffering the full archive in memory
      await uploadArchive(uploadUrl, archivePath);

      // Cleanup temp file
      try { fs.unlinkSync(archivePath); } catch {}

      console.log(`[vm-agent] Sync upload complete: ${objectName} (${stats.size} bytes)`);
      json(res, 200, { ok: true, objectName, bytes: stats.size });
    } catch (e: any) {
      console.error('[vm-agent] sync/upload error:', e?.message);
      json(res, 500, { ok: false, error: e?.message || 'sync_upload_failed' });
    }
    return;
  }

  // POST /sync/download — download backup from GCS and extract to workspace
  if (method === 'POST' && url === '/sync/download') {
    try {
      const body = await readBody(req);
      const { downloadUrl, objectName } = body;
      if (!downloadUrl) {
        json(res, 400, { ok: false, error: 'missing_download_url' });
        return;
      }

      const { execFileSync } = require('child_process');
      const workspacePath = process.env.STUARD_WORKSPACE || '/home/stuard';
      const tempPath = `/tmp/sync-download-${Date.now()}.tar.gz`;

      // Download from GCS via signed URL without materializing the full archive in memory
      console.log(`[vm-agent] Downloading backup ${objectName} for restore...`);
      const bytes = await downloadArchive(downloadUrl, tempPath);
      console.log(`[vm-agent] Downloaded ${bytes} bytes`);

      // Ensure workspace dir exists
      fs.mkdirSync(workspacePath, { recursive: true });

      // Extract to workspace
      execFileSync('tar', ['-xzf', tempPath, '-C', workspacePath], { timeout: 600_000 });
      try { fs.unlinkSync(tempPath); } catch {}

      // Bring back long-lived non-workflow deploys after cold restore.
      const restoredDeploys = await deployExecutor.restoreAll().catch((e: any) => ({
        restored: [] as string[],
        skipped: [] as string[],
        failed: [{ id: 'restore_all', error: String(e?.message || e) }],
      }));

      console.log(`[vm-agent] Sync restore complete: ${objectName}`);
      json(res, 200, { ok: true, objectName, bytes, restoredDeploys });
    } catch (e: any) {
      console.error('[vm-agent] sync/download error:', e?.message);
      json(res, 500, { ok: false, error: e?.message || 'sync_download_failed' });
    }
    return;
  }

  json(res, 404, { ok: false, error: 'not_found' });
});

const proxyWss = new WebSocketServer({ noServer: true });

proxyWss.on('connection', (clientWs) => {
  const upstreamWs = new WebSocket(LOCAL_AGENT_WS_URL);
  const pendingFrames: Array<{ data: Buffer; isBinary: boolean }> = [];
  let upstreamOpen = false;

  const flushPending = () => {
    if (!upstreamOpen) return;
    while (pendingFrames.length > 0) {
      const frame = pendingFrames.shift();
      if (!frame) continue;
      upstreamWs.send(frame.data, { binary: frame.isBinary });
    }
  };

  const closeClient = (code?: number, reason?: string) => {
    try {
      if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
        clientWs.close(code, reason);
      }
    } catch {
      try { clientWs.terminate(); } catch {}
    }
  };

  const closeUpstream = () => {
    try {
      if (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) {
        upstreamWs.close();
      }
    } catch {
      try { upstreamWs.terminate(); } catch {}
    }
  };

  clientWs.on('message', (data, isBinary) => {
    const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (upstreamOpen && upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.send(frame, { binary: isBinary });
      return;
    }
    if (upstreamWs.readyState === WebSocket.CONNECTING) {
      pendingFrames.push({ data: frame, isBinary });
      return;
    }
    closeClient(1011, 'vm_local_agent_unavailable');
  });

  clientWs.on('close', () => {
    closeUpstream();
  });

  clientWs.on('error', () => {
    closeUpstream();
  });

  upstreamWs.on('open', () => {
    upstreamOpen = true;
    flushPending();
  });

  upstreamWs.on('message', (data, isBinary) => {
    try {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    } catch {
      closeUpstream();
      closeClient();
    }
  });

  upstreamWs.on('close', (code, reason) => {
    closeClient(code, reason.toString());
  });

  upstreamWs.on('error', (err: any) => {
    try {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', message: `vm_local_agent_proxy_failed: ${String(err?.message || err)}` }));
      }
    } catch {}
    closeClient(1011, 'vm_local_agent_proxy_failed');
    closeUpstream();
  });
});

server.on('upgrade', (req, socket, head) => {
  let parsed: URL;
  try {
    parsed = new URL(req.url || '/', 'http://localhost');
  } catch {
    socket.destroy();
    return;
  }

  if (parsed.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  if (!verifyBearerToken(authHeaderFromRequest(req))) {
    try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); } catch {}
    socket.destroy();
    return;
  }

  proxyWss.handleUpgrade(req, socket, head, (ws) => {
    proxyWss.emit('connection', ws, req);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

export function startAgent(): void {
  console.log('[vm-agent] Starting Stuard VM Agent v' + AGENT_VERSION);
  console.log(`[vm-agent] User: ${USER_ID}`);
  console.log(`[vm-agent] HTTP server on port ${PORT}`);

  initMetrics();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[vm-agent] Listening on http://0.0.0.0:${PORT}`);
    deployExecutor.restoreAll()
      .then((summary) => {
        if (summary.restored.length > 0 || summary.failed.length > 0) {
          console.log(`[vm-agent] Deploy restore summary: restored=${summary.restored.length} skipped=${summary.skipped.length} failed=${summary.failed.length}`);
        }
      })
      .catch((e: any) => {
        console.warn(`[vm-agent] Initial deploy restore failed: ${String(e?.message || e)}`);
      });
  });

  // Graceful shutdown
  const shutdown = (sig: string) => {
    console.log(`[vm-agent] Received ${sig}, shutting down...`);
    deployExecutor.stopAll();
    shellExecutor.destroyAll();
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Auto-start if run directly
if (require.main === module) {
  startAgent();
}
