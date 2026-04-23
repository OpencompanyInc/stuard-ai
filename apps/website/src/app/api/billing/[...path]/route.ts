import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthedUser,
  getCreditSummary,
  getUsageBreakdown,
  getUsageLogs,
  resolvePeriodStart,
} from '@/lib/billingDb';

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

async function proxyToCloud(req: NextRequest, path: string[]): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization') || '';
  try {
    const upstream = await fetch(
      `${getCloudApiBase()}/v1/${path.join('/')}${req.nextUrl.search}`,
      {
        method: 'GET',
        headers: { Authorization: authHeader, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      },
    );
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
      { status: timedOut ? 504 : 502 },
    );
  }
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { path = [] } = await params;
  const authHeader = req.headers.get('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Primary: serve credits endpoints from the website's own Supabase client.
  if (path[0] === 'credits') {
    const user = await getAuthedUser(authHeader);
    if (!user) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const since = req.nextUrl.searchParams.get('since');
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0);

    try {
      if (path.length === 1) {
        const summary = await getCreditSummary(user.id);
        return NextResponse.json({ ok: true, ...summary });
      }
      if (path[1] === 'usage') {
        const breakdown = await getUsageBreakdown(user.id, resolvePeriodStart(since));
        const totalCredits = breakdown.reduce((s, b) => s + b.credits, 0);
        const totalCostUsd = breakdown.reduce((s, b) => s + b.costUsd, 0);
        return NextResponse.json({
          ok: true,
          breakdown,
          totalCredits: Number(totalCredits.toFixed(2)),
          totalCostUsd: Number(totalCostUsd.toFixed(4)),
        });
      }
      if (path[1] === 'logs') {
        const logs = await getUsageLogs(user.id, limit, offset, resolvePeriodStart(since));
        return NextResponse.json({ ok: true, ...logs });
      }
    } catch (e: any) {
      // If our direct reads throw unexpectedly, fall back to cloud-ai.
      console.error('billing native read failed, falling back to cloud-ai:', e?.message);
      return proxyToCloud(req, path);
    }
  }

  return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
}
