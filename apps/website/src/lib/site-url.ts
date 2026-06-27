import { headers } from 'next/headers';

const DEFAULT_PRODUCTION_URL = 'https://stuard.ai';

function normalizeSiteUrl(url: string): string {
  return url.replace(/\/$/, '');
}

/** Build-time / env fallback (no request context). */
export function getSiteUrlFromEnv(): string {
  if (process.env.NODE_ENV === 'development') {
    return normalizeSiteUrl(
      process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    );
  }

  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return normalizeSiteUrl(fromEnv);

  return DEFAULT_PRODUCTION_URL;
}

/** Request-aware site URL for OG tags and JSON-LD (social crawlers use the page host). */
export async function getRequestSiteUrl(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return normalizeSiteUrl(fromEnv);

  if (process.env.NODE_ENV === 'development') {
    return getSiteUrlFromEnv();
  }

  try {
    const h = await headers();
    const host =
      h.get('x-forwarded-host')?.split(',')[0]?.trim() ||
      h.get('host')?.split(',')[0]?.trim();
    const proto =
      h.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';

    if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
      return normalizeSiteUrl(`${proto}://${host}`);
    }
  } catch {
    // headers() unavailable during static generation
  }

  return DEFAULT_PRODUCTION_URL;
}
