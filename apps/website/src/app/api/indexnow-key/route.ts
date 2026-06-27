// IndexNow key endpoint. Search engines fetch this to verify ownership
// before accepting our /indexnow pings (see cloud-ai/src/utils/indexnow.ts).
//
// Set INDEXNOW_KEY in the website's environment to the same value used by
// cloud-ai. Returns 404 if not configured.

export function GET() {
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    return new Response('Not configured', { status: 404 });
  }
  return new Response(key, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
