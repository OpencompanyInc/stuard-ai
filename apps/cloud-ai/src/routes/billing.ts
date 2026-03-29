import type { IncomingMessage, ServerResponse } from 'http';
import { Polar } from '@polar-sh/sdk';
import { verifyToken } from '../supabase';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS };

function getPolarClient(): Polar | null {
  const accessToken = process.env.POLAR_ACCESS_TOKEN || '';
  if (!accessToken) return null;
  return new Polar({ accessToken });
}

function reply(res: ServerResponse, status: number, data: any) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...JSON_HEADERS, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<{ userId: string; email?: string } | null> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = token ? await verifyToken(token) : null;
  if (!user) {
    reply(res, 401, { ok: false, error: 'unauthorized' });
  }
  return user;
}

export async function handleBillingRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (!parsedUrl.pathname.startsWith('/v1/billing')) return false;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }

  const polar = getPolarClient();
  if (!polar) {
    reply(res, 503, { ok: false, error: 'Billing service not configured' });
    return true;
  }

  // GET /v1/billing/products
  if (req.method === 'GET' && parsedUrl.pathname === '/v1/billing/products') {
    try {
      const products = await polar.products.list({ isArchived: false });
      reply(res, 200, {
        ok: true,
        products: products.result.items.map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          prices: p.prices?.map((price: any) => ({
            id: price.id,
            amount: price.priceAmount,
            currency: price.priceCurrency,
            type: price.type,
            recurringInterval: price.recurringInterval,
          })) || [],
          isRecurring: p.isRecurring,
          benefits: p.benefits?.map((b: any) => b.description) || [],
        })),
      });
    } catch (e: any) {
      reply(res, 500, { ok: false, error: e?.message || 'Failed to list products' });
    }
    return true;
  }

  // GET /v1/billing/customer?email=...
  if (req.method === 'GET' && parsedUrl.pathname === '/v1/billing/customer') {
    const user = await authenticate(req, res);
    if (!user) return true;

    const email = parsedUrl.searchParams.get('email') || user.email;
    if (!email) {
      reply(res, 400, { ok: false, error: 'email required' });
      return true;
    }

    try {
      const customers = await polar.customers.list({ email });
      if (!customers.result.items.length) {
        reply(res, 200, { ok: true, customer: null });
        return true;
      }

      const customer = customers.result.items[0];
      const [subscriptions, orders] = await Promise.all([
        polar.subscriptions.list({ customerId: customer.id }),
        polar.orders.list({ customerId: customer.id }),
      ]);

      reply(res, 200, {
        ok: true,
        customer: {
          id: customer.id,
          email: customer.email,
          subscriptions: subscriptions.result.items.map((sub: any) => ({
            id: sub.id,
            status: sub.status,
            productId: sub.productId,
            productName: sub.product?.name || 'Unknown',
            currentPeriodEnd: sub.currentPeriodEnd,
          })),
          orders: orders.result.items.map((order: any) => ({
            id: order.id,
            amount: order.amount,
            currency: order.currency,
            createdAt: order.createdAt,
          })),
        },
      });
    } catch (e: any) {
      reply(res, 500, { ok: false, error: e?.message || 'Failed to get customer' });
    }
    return true;
  }

  // POST /v1/billing/checkout
  if (req.method === 'POST' && parsedUrl.pathname === '/v1/billing/checkout') {
    const user = await authenticate(req, res);
    if (!user) return true;

    const body = await readBody(req);
    const { productId, customerEmail, userId, successUrl } = body;
    if (!productId) {
      reply(res, 400, { ok: false, error: 'productId required' });
      return true;
    }

    try {
      const result = await polar.checkouts.create({
        products: [productId],
        successUrl: successUrl || process.env.POLAR_SUCCESS_URL || 'https://stuard.ai/billing/success?checkout_id={CHECKOUT_ID}',
        customerEmail: customerEmail || user.email,
        metadata: (userId || user.userId) ? { userId: userId || user.userId } : undefined,
      });

      reply(res, 200, { ok: true, url: result.url || null });
    } catch (e: any) {
      reply(res, 500, { ok: false, error: e?.message || 'Failed to create checkout' });
    }
    return true;
  }

  // POST /v1/billing/portal
  if (req.method === 'POST' && parsedUrl.pathname === '/v1/billing/portal') {
    const user = await authenticate(req, res);
    if (!user) return true;

    const body = await readBody(req);
    const { customerId } = body;
    if (!customerId) {
      reply(res, 400, { ok: false, error: 'customerId required' });
      return true;
    }

    try {
      const session = await polar.customerSessions.create({ customerId });
      reply(res, 200, { ok: true, url: session.customerPortalUrl || null });
    } catch (e: any) {
      reply(res, 500, { ok: false, error: e?.message || 'Failed to open customer portal' });
    }
    return true;
  }

  return false;
}
