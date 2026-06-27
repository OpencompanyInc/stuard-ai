// IndexNow ping: tell Bing/Yandex/Seznam (and downstream IndexNow partners)
// that a URL has been created or updated, so they fetch it within minutes
// instead of waiting for the next sitemap crawl.
//
// Setup:
//   1. Pick a 32+ char hex key.
//   2. Set INDEXNOW_KEY on cloud-ai AND on the website (both need it).
//   3. The website serves it at /api/indexnow-key (see that route).
//   4. Set INDEXNOW_HOST if the production host differs from 'stuard.ai'.

const ENDPOINT = 'https://api.indexnow.org/indexnow';

export function pingIndexNow(urls: string[]): void {
  const key = process.env.INDEXNOW_KEY;
  if (!key || urls.length === 0) return;

  const host = process.env.INDEXNOW_HOST || 'stuard.ai';
  const keyLocation = `https://${host}/api/indexnow-key`;

  const body = JSON.stringify({
    host,
    key,
    keyLocation,
    urlList: urls,
  });

  // Fire-and-forget — never block the calling request on IndexNow.
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`[indexnow] non-OK response: ${res.status}`);
      }
    })
    .catch((err) => {
      console.warn('[indexnow] ping failed:', err?.message || err);
    });
}

export function workflowUrl(slug: string): string {
  const host = process.env.INDEXNOW_HOST || 'stuard.ai';
  return `https://${host}/marketplace/${slug}`;
}
