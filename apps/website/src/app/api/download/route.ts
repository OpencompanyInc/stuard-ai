export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type UpdateChannel = 'stable' | 'beta' | 'staging';
type DownloadPlatform = 'windows' | 'darwin' | 'linux';

function getEnv(name: string): string | undefined {
  return process.env[name] || process.env[`NEXT_PUBLIC_${name}`];
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function getUpdateBaseUrl(): string {
  const fromEnv =
    getEnv('STUARD_UPDATE_BASE_URL') ||
    getEnv('UPDATE_BASE_URL') ||
    getEnv('UPDATE_FEED_BASE_URL') ||
    getEnv('UPDATE_FEED_URL');
  return normalizeBaseUrl(fromEnv || 'https://updates.stuard.ai/desktop');
}

function stripYamlValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function resolveChannelFromHost(hostname: string): UpdateChannel | null {
  const host = hostname.toLowerCase();
  if (host.includes('beta.stuard.ai')) return 'beta';
  if (host.includes('staging.stuard.ai')) return 'staging';
  return null;
}

function resolveChannelFromEnv(): UpdateChannel | null {
  const explicit = (getEnv('UPDATE_CHANNEL') || getEnv('NEXT_PUBLIC_UPDATE_CHANNEL') || '').toLowerCase();
  if (explicit === 'beta' || explicit === 'staging' || explicit === 'stable') return explicit;

  const cloudApiUrl = (getEnv('CLOUD_PUBLIC_URL') || getEnv('NEXT_PUBLIC_CLOUD_API_URL') || '').toLowerCase();
  if (cloudApiUrl.includes('beta-api.stuard.ai')) return 'beta';
  if (cloudApiUrl.includes('staging-api.stuard.ai')) return 'staging';
  if (cloudApiUrl.includes('api.stuard.ai')) return 'stable';

  return null;
}

function resolveChannel(req: Request): UpdateChannel {
  const url = new URL(req.url);
  const channel = (url.searchParams.get('channel') || '').toLowerCase();
  if (channel === 'beta' || channel === 'staging' || channel === 'stable') return channel;

  const fromHost = resolveChannelFromHost(url.hostname);
  if (fromHost) return fromHost;

  const fromEnv = resolveChannelFromEnv();
  if (fromEnv) return fromEnv;

  return 'stable';
}

function resolvePlatform(req: Request): DownloadPlatform {
  const url = new URL(req.url);
  const platform = (url.searchParams.get('platform') || 'windows').toLowerCase();
  if (platform === 'mac' || platform === 'macos' || platform === 'darwin') return 'darwin';
  if (platform === 'linux') return 'linux';
  return 'windows';
}

function getFeedUrl(channel: UpdateChannel): string {
  return `${getUpdateBaseUrl()}/${channel}`;
}

function getManifestName(platform: DownloadPlatform): string {
  if (platform === 'darwin') return 'latest-mac.yml';
  if (platform === 'linux') return 'latest-linux.yml';
  return 'latest.yml';
}

function extractAssetPath(manifestText: string): string | null {
  const directPath = manifestText.match(/^path:\s*(.+)$/m)?.[1];
  if (directPath) return stripYamlValue(directPath);

  const fileUrl = manifestText.match(/^\s*url:\s*(.+)$/m)?.[1];
  if (fileUrl) return stripYamlValue(fileUrl);

  return null;
}

export async function GET(req: Request) {
  try {
    const channel = resolveChannel(req);
    const platform = resolvePlatform(req);
    const manifestUrl = `${getFeedUrl(channel)}/${getManifestName(platform)}`;
    const manifestRes = await fetch(manifestUrl, { cache: 'no-store' });

    if (!manifestRes.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch update manifest', status: manifestRes.status, manifestUrl, channel, platform }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }

    const manifestText = await manifestRes.text();
    const assetPath = extractAssetPath(manifestText);

    if (!assetPath) {
      return new Response(
        JSON.stringify({ error: 'No downloadable asset path found in update manifest', manifestUrl, channel, platform }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      );
    }

    const downloadUrl = /^https?:\/\//i.test(assetPath)
      ? assetPath
      : `${getFeedUrl(channel)}/${assetPath.replace(/^\/+/, '')}`;

    return Response.redirect(downloadUrl, 302);
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Unexpected error resolving download', details: String(error) }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}