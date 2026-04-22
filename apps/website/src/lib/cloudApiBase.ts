const STABLE_CLOUD_API_ORIGIN = 'https://api.stuard.ai';
const BETA_CLOUD_API_ORIGIN = 'https://beta-api.stuard.ai';
const STAGING_CLOUD_API_ORIGIN = 'https://staging-api.stuard.ai';

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function isLocalDevHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '[::1]';
}

function resolveChannelFromHostname(hostname: string): 'stable' | 'beta' | 'staging' {
  const host = hostname.toLowerCase();
  if (isLocalDevHostname(host)) return 'beta';
  if (host.includes('beta.stuard.ai')) return 'beta';
  if (host.includes('staging.stuard.ai')) return 'staging';
  return 'stable';
}

function originForChannel(channel: 'stable' | 'beta' | 'staging'): string {
  if (channel === 'beta') return BETA_CLOUD_API_ORIGIN;
  if (channel === 'staging') return STAGING_CLOUD_API_ORIGIN;
  return STABLE_CLOUD_API_ORIGIN;
}

export function resolveCloudApiOriginFromRequest(request: Request): string {
  const configured = process.env.CLOUD_API_URL || process.env.NEXT_PUBLIC_CLOUD_API_URL;
  if (configured) return normalizeBaseUrl(configured);

  try {
    const url = new URL(request.url);
    return originForChannel(resolveChannelFromHostname(url.hostname));
  } catch {
    return STABLE_CLOUD_API_ORIGIN;
  }
}

export function resolveBrowserCloudApiOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_CLOUD_API_URL;
  if (configured) return normalizeBaseUrl(configured);

  if (typeof window !== 'undefined') {
    return originForChannel(resolveChannelFromHostname(window.location.hostname));
  }

  return STABLE_CLOUD_API_ORIGIN;
}

export function buildWebsiteCloudProxyPath(path: string): string {
  const normalized = path.startsWith('/v1/') ? path.slice(3) : path;
  return `/api/cloud${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
}
