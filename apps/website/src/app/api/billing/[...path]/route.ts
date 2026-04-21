import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function getCloudApiBase(): string {
  const configured =
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_CLOUD_API_URL ||
    'https://api.stuard.ai';
  return configured.endsWith('/') ? configured.slice(0, -1) : configured;
}

function buildTargetUrl(req: NextRequest, path: string[]): string {
  return `${getCloudApiBase()}/v1/${path.join('/')}${req.nextUrl.search}`;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { path = [] } = await params;
  const authHeader = req.headers.get('authorization') || '';

  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  if (path.length === 0 || path[0] !== 'credits') {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  try {
    const upstream = await fetch(buildTargetUrl(req, path), {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });

    const body = await upstream.text();

    return new NextResponse(body || JSON.stringify({ ok: upstream.ok }), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    return NextResponse.json(
      {
        ok: false,
        error: timedOut ? 'request_timeout' : 'billing_service_unreachable',
        message: timedOut ? 'Billing request timed out.' : 'Unable to reach billing service.',
      },
      { status: timedOut ? 504 : 502 }
    );
  }
}