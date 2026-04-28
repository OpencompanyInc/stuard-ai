/**
 * Cloud Preview Proxy
 *
 * Surfaces a localhost dev server (Next.js, Vite, CRA, etc.) running inside
 * the user's VM to the desktop iframe. Two-layer relay:
 *
 *   browser iframe                  cloud-ai                 VM agent
 *   /v1/cloud-engine/preview/  →   raw fetch  →   /proxy/<port>/<path>  →  127.0.0.1:<port>
 *      <sid>/<port>/<path>                          (HMAC bearer auth)
 *
 * Authentication: an iframe can't attach an Authorization header, so we
 * mint a short-lived sid (POST /preview/start) and put it in the URL.
 * The sid is opaque — never the user's JWT.
 *
 * Absolute paths: dev servers emit lots of `/foo.js` URLs that don't carry
 * the /preview/<sid>/<port>/ prefix. We handle those three ways:
 *   (1) Inject `<base href>` in HTML so relative URLs resolve under the
 *       prefix.
 *   (2) Rewrite obvious absolute-path attributes (href/src/action/srcset)
 *       in HTML responses so SSR'd pages load their static chunks.
 *   (3) Last-resort fallback: requests to cloud-ai that no other route
 *       handles, but have a Referer pointing back at a preview URL, are
 *       routed via that preview.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import http from 'http';
import type { Duplex } from 'stream';
import { verifyToken } from '../supabase';
import { resolveVMBaseUrl, resolveVMSecret } from '../services/vm-command';
import { mintVMToken } from '../services/vm-tokens';
import { mintViewSession, lookupViewSession, VIEW_SESSION_TTL_MS } from '../services/view-sessions';

const PREVIEW_PREFIX = '/v1/cloud-engine/preview/';

interface PreviewTarget {
  userId: string;
  port: number;
  /** Path component on the dev server, must start with '/'. */
  upstreamPath: string;
  /** sid that resolved this target — used for cookie + base href. */
  sid: string;
}

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

async function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')); }
      catch { reject(new Error('invalid_json')); }
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

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const piece of header.split(';')) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const k = piece.slice(0, eq).trim();
    const v = piece.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** Match `/v1/cloud-engine/preview/<sid>/<port>/<rest...>` */
function parsePreviewPath(pathname: string): { sid: string; port: number; rest: string } | null {
  if (!pathname.startsWith(PREVIEW_PREFIX)) return null;
  const tail = pathname.slice(PREVIEW_PREFIX.length);
  const m = tail.match(/^([A-Za-z0-9_\-]+)\/(\d+)(\/.*)?$/);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { sid: m[1], port, rest: m[3] || '/' };
}

/**
 * Resolve the proxy target for a request. Priority:
 *   1) /v1/cloud-engine/preview/<sid>/<port>/...   (explicit URL)
 *   2) Referer: <origin>/v1/cloud-engine/preview/<sid>/<port>/...
 *   3) Cookie cloud_preview_<port>=<sid>
 */
function resolveTarget(req: IncomingMessage, parsedUrl: URL): PreviewTarget | null {
  // (1) explicit URL
  const explicit = parsePreviewPath(parsedUrl.pathname);
  if (explicit) {
    const sess = lookupViewSession(explicit.sid);
    if (!sess) return null;
    return {
      userId: sess.userId,
      port: explicit.port,
      sid: explicit.sid,
      upstreamPath: explicit.rest + (parsedUrl.search || ''),
    };
  }

  // (2) Referer fallback — for absolute-path asset requests
  const ref = String(req.headers['referer'] || '');
  if (ref) {
    try {
      const refUrl = new URL(ref);
      const refMatch = parsePreviewPath(refUrl.pathname);
      if (refMatch) {
        const sess = lookupViewSession(refMatch.sid);
        if (sess) {
          // Pass the original requested path through to the dev server.
          const fullPath = parsedUrl.pathname + (parsedUrl.search || '');
          return {
            userId: sess.userId,
            port: refMatch.port,
            sid: refMatch.sid,
            upstreamPath: fullPath,
          };
        }
      }
    } catch { /* ignore */ }
  }

  // (3) Cookie fallback — keyed by port so multiple previews don't collide
  const cookies = parseCookies(req.headers['cookie'] as string | undefined);
  for (const [name, sid] of Object.entries(cookies)) {
    const m = name.match(/^cloud_preview_(\d+)$/);
    if (!m) continue;
    const sess = lookupViewSession(sid);
    if (!sess) continue;
    return {
      userId: sess.userId,
      port: Number(m[1]),
      sid,
      upstreamPath: parsedUrl.pathname + (parsedUrl.search || ''),
    };
  }

  return null;
}

/** Forward an HTTP request through cloud-ai to the VM agent's /proxy. */
async function forwardHttp(req: IncomingMessage, res: ServerResponse, target: PreviewTarget): Promise<void> {
  const baseUrl = await resolveVMBaseUrl(target.userId);
  if (!baseUrl) { json(res, 502, { ok: false, error: 'vm_not_reachable' }); return; }

  const secret = await resolveVMSecret(target.userId);
  const token = mintVMToken(secret, target.userId, 'cloud-ai-preview');

  const upstreamUrl = new URL(`${baseUrl}/proxy/${target.port}${target.upstreamPath}`);

  // Build forwarded headers — drop hop-by-hop + cookies we shouldn't leak,
  // add our bearer for the VM agent. Path-info (X-Forwarded-Prefix) lets a
  // smart upstream emit absolute URLs that work in the iframe.
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    const lk = k.toLowerCase();
    if (lk === 'host' || lk === 'connection' || lk === 'authorization' ||
        lk === 'keep-alive' || lk === 'proxy-authenticate' || lk === 'proxy-authorization' ||
        lk === 'te' || lk === 'trailer' || lk === 'upgrade' || lk === 'content-length') continue;
    headers[k] = v as any;
  }
  headers['authorization'] = `Bearer ${token}`;
  headers['x-forwarded-prefix'] = `${PREVIEW_PREFIX}${target.sid}/${target.port}`;
  headers['x-forwarded-host'] = String(req.headers['host'] || '');
  headers['x-forwarded-proto'] = (req.socket as any)?.encrypted ? 'https' : 'http';

  const upstream = http.request({
    host: upstreamUrl.hostname,
    port: Number(upstreamUrl.port) || 80,
    method: req.method,
    path: upstreamUrl.pathname + upstreamUrl.search,
    headers,
  });

  const cleanup = () => { try { upstream.destroy(); } catch {} };

  upstream.on('response', (upRes) => {
    const outHeaders: http.OutgoingHttpHeaders = { ...upRes.headers };
    delete outHeaders['connection'];
    delete outHeaders['keep-alive'];
    delete outHeaders['transfer-encoding'];
    // Iframe needs the cookie to make Referer-less requests routable too.
    const setCookie = `cloud_preview_${target.port}=${target.sid}; Path=/; SameSite=None; Secure; Max-Age=300`;
    const existingCookie = outHeaders['set-cookie'];
    if (Array.isArray(existingCookie)) outHeaders['set-cookie'] = [...existingCookie, setCookie];
    else if (typeof existingCookie === 'string') outHeaders['set-cookie'] = [existingCookie, setCookie];
    else outHeaders['set-cookie'] = [setCookie];
    // Allow the iframe to load.
    outHeaders['x-frame-options'] = 'SAMEORIGIN';
    delete outHeaders['content-security-policy'];

    const ct = String(upRes.headers['content-type'] || '').toLowerCase();
    const isHtml = ct.includes('text/html');

    if (isHtml) {
      // Buffer the HTML so we can inject <base> and rewrite absolute paths.
      // Dev-server HTML is small (KBs); buffering is fine. Skip rewrite if
      // the upstream returned a stream that's too large to be HTML anyway.
      const chunks: Buffer[] = [];
      let totalLen = 0;
      const MAX_HTML = 5 * 1024 * 1024;
      upRes.on('data', (c: Buffer) => {
        totalLen += c.length;
        if (totalLen > MAX_HTML) { upstream.destroy(); return; }
        chunks.push(c);
      });
      upRes.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf-8');
        const rewritten = rewriteHtml(html, target);
        const buf = Buffer.from(rewritten, 'utf-8');
        outHeaders['content-length'] = buf.length;
        delete outHeaders['content-encoding'];
        res.writeHead(upRes.statusCode || 502, outHeaders);
        res.end(buf);
      });
      upRes.on('error', cleanup);
      return;
    }

    // Rewrite Location: /foo so redirects keep working inside the iframe.
    if (typeof outHeaders['location'] === 'string' && outHeaders['location'].startsWith('/')
        && !outHeaders['location'].startsWith(PREVIEW_PREFIX)) {
      outHeaders['location'] = `${PREVIEW_PREFIX}${target.sid}/${target.port}${outHeaders['location']}`;
    }

    res.writeHead(upRes.statusCode || 502, outHeaders);
    upRes.pipe(res);
    upRes.on('error', cleanup);
  });

  upstream.on('error', (err: any) => {
    if (!res.headersSent) {
      json(res, 502, { ok: false, error: 'preview_upstream_failed', detail: String(err?.message || err) });
    } else {
      try { res.end(); } catch {}
    }
  });

  res.on('close', cleanup);
  req.pipe(upstream);
}

/**
 * Inject <base> and rewrite obvious absolute-path attributes so server-rendered
 * pages load their assets through the proxy. Runtime fetch()/XHR rely on the
 * Referer/cookie fallback paths.
 */
function rewriteHtml(html: string, target: PreviewTarget): string {
  const prefix = `${PREVIEW_PREFIX}${target.sid}/${target.port}`;

  // 1. Inject <base> right after <head> if present.
  let out = html;
  const baseTag = `<base href="${prefix}/">`;
  const headOpenMatch = out.match(/<head[^>]*>/i);
  if (headOpenMatch) {
    const idx = headOpenMatch.index! + headOpenMatch[0].length;
    out = out.slice(0, idx) + baseTag + out.slice(idx);
  } else {
    out = baseTag + out;
  }

  // 2. Rewrite href/src/action/poster/data attributes that start with `/` (but
  //    not `//` protocol-relative). Skips data:, blob:, javascript: and #anchors.
  out = out.replace(
    /\b(href|src|action|poster|data|formaction)\s*=\s*(['"])(\/[^/'"\s][^'"\s]*)\2/gi,
    (_m, attr, q, path) => `${attr}=${q}${prefix}${path}${q}`,
  );

  // 3. srcset can contain multiple URLs.
  out = out.replace(
    /\bsrcset\s*=\s*(['"])([^'"]+)\1/gi,
    (_m, q, val) => {
      const rewritten = val.split(',').map((part: string) => {
        const trimmed = part.trim();
        if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return part;
        return ' ' + prefix + trimmed;
      }).join(',');
      return `srcset=${q}${rewritten}${q}`;
    },
  );

  return out;
}

/** Cloud-ai → VM agent: WebSocket upgrade pipe. */
async function forwardWsUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, target: PreviewTarget): Promise<void> {
  const baseUrl = await resolveVMBaseUrl(target.userId);
  if (!baseUrl) {
    try { socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
    socket.destroy();
    return;
  }

  const secret = await resolveVMSecret(target.userId);
  const token = mintVMToken(secret, target.userId, 'cloud-ai-preview-ws');
  const u = new URL(`${baseUrl}/proxy/${target.port}${target.upstreamPath}`);

  const headerLines: string[] = [];
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lk = name.toLowerCase();
    if (lk === 'host' || lk === 'authorization') continue;
    if (Array.isArray(value)) {
      for (const v of value) headerLines.push(`${name}: ${v}`);
    } else {
      headerLines.push(`${name}: ${value}`);
    }
  }
  headerLines.unshift(`Host: ${u.host}`);
  headerLines.push(`Authorization: Bearer ${token}`);

  const handshake =
    `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
    headerLines.join('\r\n') +
    `\r\n\r\n`;

  const net = require('net') as typeof import('net');
  const upstream = net.connect(Number(u.port) || 80, u.hostname);

  const closeBoth = () => {
    try { upstream.destroy(); } catch {}
    try { socket.destroy(); } catch {}
  };

  upstream.on('connect', () => {
    upstream.write(handshake);
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on('error', () => {
    try { socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
    closeBoth();
  });

  socket.on('error', closeBoth);
  socket.on('close', closeBoth);
  upstream.on('close', closeBoth);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────────────────────

/** Routes the explicit /preview/* URLs and the /preview/start mint endpoint. */
export async function handleCloudPreviewRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const path = parsedUrl.pathname;

  // POST /v1/cloud-engine/preview/start { port }
  if (req.method === 'POST' && path === '/v1/cloud-engine/preview/start') {
    const user = await authenticate(req, res);
    if (!user) return true;
    let body: any;
    try { body = await readJsonBody(req); }
    catch (e: any) { json(res, 400, { ok: false, error: e?.message || 'invalid_json' }); return true; }
    const port = Number(body?.port);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      json(res, 400, { ok: false, error: 'bad_port' });
      return true;
    }
    const { sid, expiresAt } = mintViewSession(user.userId);
    json(res, 200, {
      ok: true,
      sid,
      port,
      expiresAt,
      ttlMs: VIEW_SESSION_TTL_MS,
      url: `${PREVIEW_PREFIX}${sid}/${port}/`,
    });
    return true;
  }

  // ANY /v1/cloud-engine/preview/<sid>/<port>/<rest...>
  if (path.startsWith(PREVIEW_PREFIX)) {
    const target = resolveTarget(req, parsedUrl);
    if (!target) { json(res, 401, { ok: false, error: 'invalid_preview_session' }); return true; }
    await forwardHttp(req, res, target);
    return true;
  }

  return false;
}

/**
 * Last-resort fallback: routes any unrecognized request to the active preview
 * if Referer or cookies indicate one. Must be registered AFTER all real routes
 * so we never shadow a legitimate cloud-ai endpoint.
 */
export async function handleCloudPreviewFallback(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  // Don't try to fall back into our own preview prefix or auth-style paths.
  if (parsedUrl.pathname.startsWith(PREVIEW_PREFIX)) return false;
  const target = resolveTarget(req, parsedUrl);
  if (!target) return false;
  await forwardHttp(req, res, target);
  return true;
}

/** Returns true and starts proxying if this upgrade is a preview WS. */
export async function handleCloudPreviewWsUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  parsedUrl: URL,
): Promise<boolean> {
  // Only handle explicit /preview/<sid>/<port>/ upgrades — Referer-based WS
  // routing is too risky (browsers don't always send Referer on WS handshakes).
  const target = resolveTarget(req, parsedUrl);
  if (!target) return false;
  if (!parsedUrl.pathname.startsWith(PREVIEW_PREFIX)) return false;
  await forwardWsUpgrade(req, socket, head, target);
  return true;
}
