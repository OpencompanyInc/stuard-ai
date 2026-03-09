import { getCloudAiHttp } from './cloud';

const DEFAULT_AGENT_HTTP = 'http://127.0.0.1:8765';
const DEFAULT_AGENT_WS = 'ws://127.0.0.1:8765/ws';

export interface AgentEndpointResolution {
  wsUrl: string;
  httpUrl: string | null;
  usesVmRelay: boolean;
  relayUrl: string | null;
}

interface AgentFetchOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  accessToken?: string | null;
  timeoutMs?: number;
}

function trimUrl(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isWsUrl(value: string): boolean {
  return /^wss?:\/\//i.test(String(value || '').trim());
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function urlPathEndsWith(value: string, suffix: string): boolean {
  const parsed = parseUrl(value);
  return !!parsed && parsed.pathname.replace(/\/+$/, '').endsWith(suffix);
}

function toHttpBase(wsUrl: string): string {
  const parsed = parseUrl(wsUrl);
  if (!parsed) return trimUrl(wsUrl);
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  parsed.search = '';
  parsed.hash = '';
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path.endsWith('/vm/ws')) {
    parsed.pathname = path.slice(0, -'/vm/ws'.length) || '/';
  } else if (path.endsWith('/ws')) {
    parsed.pathname = path.slice(0, -'/ws'.length) || '/';
  }
  return trimUrl(parsed.toString());
}

function toWsUrl(httpUrl: string): string {
  const parsed = parseUrl(httpUrl);
  if (!parsed) return trimUrl(httpUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.search = '';
  parsed.hash = '';
  const path = parsed.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/ws') && !path.endsWith('/vm/ws')) {
    parsed.pathname = `${path || ''}/ws`;
  } else {
    parsed.pathname = path || '/ws';
  }
  return trimUrl(parsed.toString());
}

function buildVmRelayUrl(cloudHttp: string): string {
  const parsed = parseUrl(cloudHttp);
  if (!parsed) return `${trimUrl(cloudHttp)}/v1/vm/relay`;
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/v1/vm/relay`;
  return trimUrl(parsed.toString());
}

function buildVmWsUrl(cloudHttp: string): string {
  const parsed = parseUrl(cloudHttp);
  if (!parsed) {
    const trimmed = trimUrl(cloudHttp);
    return trimmed.startsWith('https://')
      ? `wss://${trimmed.slice('https://'.length)}/vm/ws`
      : `ws://${trimmed.replace(/^http:\/\//, '')}/vm/ws`;
  }
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/vm/ws`;
  return trimUrl(parsed.toString());
}

function resolveVmRelayEndpoints(cloudHttp: string): AgentEndpointResolution {
  const cloudBase = trimUrl(cloudHttp);
  return {
    wsUrl: buildVmWsUrl(cloudBase),
    httpUrl: null,
    usesVmRelay: true,
    relayUrl: buildVmRelayUrl(cloudBase),
  };
}

export function resolveAgentEndpoints(customAgentUrl?: string): AgentEndpointResolution {
  const cloudAiHttp = trimUrl(getCloudAiHttp());
  const win = window as any;
  const custom = trimUrl(customAgentUrl || '');
  const hintedWs = trimUrl(win.__AGENT_WS__ || '');
  const hintedHttp = trimUrl(win.__AGENT_HTTP__ || '');

  if (custom === 'cloud-vm' || custom === 'cloud_vm' || custom === 'vm') {
    return resolveVmRelayEndpoints(cloudAiHttp);
  }

  const primary = custom || hintedWs || hintedHttp;
  if (primary) {
    if (urlPathEndsWith(primary, '/vm/ws')) {
      return {
        wsUrl: primary,
        httpUrl: null,
        usesVmRelay: true,
        relayUrl: buildVmRelayUrl(toHttpBase(primary)),
      };
    }
    if (urlPathEndsWith(primary, '/v1/vm/relay')) {
      const parsed = parseUrl(primary);
      const cloudBase = parsed
        ? trimUrl(parsed.origin + parsed.pathname.replace(/\/v1\/vm\/relay$/, ''))
        : cloudAiHttp;
      return {
        wsUrl: buildVmWsUrl(cloudBase),
        httpUrl: null,
        usesVmRelay: true,
        relayUrl: primary,
      };
    }
    if (isWsUrl(primary)) {
      return {
        wsUrl: primary,
        httpUrl: toHttpBase(primary),
        usesVmRelay: false,
        relayUrl: null,
      };
    }
    if (isHttpUrl(primary)) {
      const httpUrl = primary;
      return {
        wsUrl: toWsUrl(httpUrl),
        httpUrl,
        usesVmRelay: false,
        relayUrl: null,
      };
    }
  }

  return {
    wsUrl: DEFAULT_AGENT_WS,
    httpUrl: DEFAULT_AGENT_HTTP,
    usesVmRelay: false,
    relayUrl: null,
  };
}

export async function agentFetchJson(
  target: AgentEndpointResolution,
  path: string,
  options?: AgentFetchOptions,
): Promise<any> {
  const method = String(options?.method || 'GET').toUpperCase();
  if (target.usesVmRelay) {
    if (!target.relayUrl) throw new Error('vm_relay_unavailable');
    const accessToken = String(options?.accessToken || '').trim();
    if (!accessToken) throw new Error('auth_required');

    const relayResp = await fetch(target.relayUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path,
        method,
        body: options?.body,
        timeoutMs: options?.timeoutMs,
      }),
    });
    const relayJson = await relayResp.json().catch(() => null);
    if (relayJson && typeof relayJson === 'object' && 'result' in relayJson) {
      return (relayJson as any).result;
    }
    return relayJson;
  }

  if (!target.httpUrl) throw new Error('agent_http_unavailable');

  const headers: Record<string, string> = {
    ...(options?.headers || {}),
  };
  let body: BodyInit | undefined;
  if (options?.body !== undefined) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const resp = await fetch(`${target.httpUrl}${path}`, {
    method,
    headers,
    body,
  });
  return resp.json();
}
