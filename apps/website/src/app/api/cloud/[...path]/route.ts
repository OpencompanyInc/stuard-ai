import { NextRequest, NextResponse } from 'next/server';
import { resolveCloudApiOriginFromRequest } from '@/lib/cloudApiBase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function buildTargetUrl(req: NextRequest, path: string[]): string {
  const base = resolveCloudApiOriginFromRequest(req);
  return `${base}/v1/${path.join('/')}${req.nextUrl.search}`;
}

async function proxyRequest(req: NextRequest, context: RouteContext, method: string) {
  const { path = [] } = await context.params;
  const authHeader = req.headers.get('authorization') || '';

  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  if (path.length === 0) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const headers = new Headers();
  headers.set('Authorization', authHeader);
  headers.set('Accept', req.headers.get('accept') || 'application/json');

  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  let body: BodyInit | undefined;
  if (!['GET', 'HEAD'].includes(method)) {
    const text = await req.text();
    body = text || undefined;
  }

  try {
    const upstream = await fetch(buildTargetUrl(req, path), {
      method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(method === 'GET' ? 30_000 : 190_000),
    });

    const responseHeaders = new Headers();
    responseHeaders.set('Cache-Control', 'no-store');

    const upstreamContentType = upstream.headers.get('content-type');
    if (upstreamContentType) responseHeaders.set('Content-Type', upstreamContentType);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error: any) {
    const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    return NextResponse.json(
      {
        ok: false,
        error: timedOut ? 'request_timeout' : 'cloud_service_unreachable',
        message: timedOut ? 'Cloud request timed out.' : `Unable to reach cloud service: ${error?.message || 'fetch_failed'}`,
      },
      { status: timedOut ? 504 : 502 },
    );
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context, 'GET');
}

export async function POST(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context, 'POST');
}

export async function PUT(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context, 'PUT');
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context, 'PATCH');
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context, 'DELETE');
}