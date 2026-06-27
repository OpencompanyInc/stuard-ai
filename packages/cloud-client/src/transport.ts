import type { CloudJsonResponse } from './types';

export type CloudFetchOptions = RequestInit & { timeoutMs?: number };

export interface CloudTransport {
  resolveUrl(path: string): string;
  fetchJson<T extends CloudJsonResponse = CloudJsonResponse>(
    path: string,
    opts?: CloudFetchOptions,
  ): Promise<T>;
}

export type GetAccessToken = () => Promise<string | null>;

async function buildAuthHeaders(
  getAccessToken: GetAccessToken,
  extra?: HeadersInit,
  includeJsonContentType = true,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) headers['Content-Type'] = 'application/json';
  const token = await getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (extra) {
    if (extra instanceof Headers) {
      extra.forEach((value, key) => { headers[key] = value; });
    } else if (Array.isArray(extra)) {
      for (const [key, value] of extra) headers[key] = value;
    } else {
      for (const [key, value] of Object.entries(extra as Record<string, string>)) {
        headers[key] = value;
      }
    }
  }
  return headers;
}

export async function fetchCloudJson<T extends CloudJsonResponse = CloudJsonResponse>(
  resolveUrl: (path: string) => string,
  getAccessToken: GetAccessToken,
  path: string,
  opts?: CloudFetchOptions & { defaultTimeoutMs?: number; parseMode?: 'auto' | 'json-only' },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? opts?.defaultTimeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = opts?.signal
    ? AbortSignal.any([opts.signal, controller.signal])
    : controller.signal;

  try {
    const { timeoutMs: _timeoutMs, defaultTimeoutMs: _defaultTimeoutMs, parseMode = 'auto', ...fetchOpts } = opts ?? {};
    const headers = await buildAuthHeaders(
      getAccessToken,
      fetchOpts.headers,
      !!fetchOpts.body,
    );
    const res = await fetch(resolveUrl(path), {
      ...fetchOpts,
      headers,
      signal,
    });

    const raw = await res.text();
    const contentType = res.headers.get('content-type') || '';
    const looksJson = contentType.includes('application/json') || raw.startsWith('{') || raw.startsWith('[');

    if (parseMode === 'json-only' || looksJson) {
      try {
        return JSON.parse(raw) as T;
      } catch {
        if (parseMode === 'json-only') {
          return {
            ok: false,
            error: 'upstream_invalid_json',
            status: res.status,
            snippet: raw.slice(0, 160),
          } as unknown as T;
        }
        if (!res.ok) {
          return {
            ok: false,
            error: `server_error_${res.status}`,
            message: raw.slice(0, 200) || `HTTP ${res.status}`,
          } as unknown as T;
        }
        return { ok: false, error: 'invalid_response', message: 'Server returned non-JSON response' } as unknown as T;
      }
    }

    return {
      ok: false,
      error: res.ok ? 'upstream_non_json' : `upstream_http_${res.status}`,
      status: res.status,
      snippet: raw.slice(0, 160).replace(/\s+/g, ' ').trim(),
      proxyPath: path,
    } as unknown as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      const error = timeoutMs >= 60_000 ? 'timeout' : 'request_timeout';
      return { ok: false, error, message: 'Request timed out' } as unknown as T;
    }
    return { ok: false, error: e?.message || 'network_error' } as unknown as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Desktop / direct HTTP transport — hits cloud-ai origin directly. */
export function createDirectTransport(options: {
  resolveBaseUrl: () => string;
  getAccessToken: GetAccessToken;
  defaultTimeoutMs?: number;
}): CloudTransport {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 180_000;
  return {
    resolveUrl(path: string) {
      return `${options.resolveBaseUrl()}${path}`;
    },
    fetchJson(path, opts) {
      return fetchCloudJson(this.resolveUrl.bind(this), options.getAccessToken, path, {
        ...opts,
        defaultTimeoutMs,
        parseMode: 'auto',
      });
    },
  };
}

/** Website proxy transport — routes through Next.js `/api/cloud/*`. */
export function createProxyTransport(options: {
  buildProxyPath: (path: string) => string;
  getAccessToken: GetAccessToken;
  defaultTimeoutMs?: number;
}): CloudTransport {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 15_000;
  return {
    resolveUrl(path: string) {
      return options.buildProxyPath(path);
    },
    fetchJson(path, opts) {
      return fetchCloudJson(this.resolveUrl.bind(this), options.getAccessToken, path, {
        ...opts,
        defaultTimeoutMs,
        parseMode: 'json-only',
      });
    },
  };
}

/** Direct browser origin transport — for SSE streams that bypass the Next proxy. */
export function createBrowserOriginTransport(options: {
  resolveOrigin: () => string;
  getAccessToken: GetAccessToken;
}): CloudTransport {
  return {
    resolveUrl(path: string) {
      return `${options.resolveOrigin()}${path}`;
    },
    fetchJson(path, opts) {
      return fetchCloudJson(this.resolveUrl.bind(this), options.getAccessToken, path, {
        ...opts,
        parseMode: 'auto',
      });
    },
  };
}
