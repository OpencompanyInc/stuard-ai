import type { IncomingMessage, ServerResponse } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '../supabase';
import { writeLog } from '../utils/logger';

// ─── Credit pricing (mirrors apps/website/src/lib/creditPricing.ts) ──────────

type PlanTier = 'free' | 'starter' | 'pro' | 'power';
type GrantSourceType = 'subscription_cycle' | 'addon_purchase';

const CREDIT_ANCHORS = [
  { amount: 5,   credits: 100  },
  { amount: 10,  credits: 230  },
  { amount: 30,  credits: 700  },
  { amount: 60,  credits: 1400 },
  { amount: 100, credits: 2500 },
  { amount: 200, credits: 5000 },
];

function planTierFromAmount(amount: number): Exclude<PlanTier, 'free'> {
  if (amount >= 100) return 'power';
  if (amount >= 30)  return 'pro';
  return 'starter';
}

function estimateCredits(amount: number): number {
  if (amount <= CREDIT_ANCHORS[0].amount) return CREDIT_ANCHORS[0].credits;
  for (let i = 1; i < CREDIT_ANCHORS.length; i++) {
    const prev = CREDIT_ANCHORS[i - 1];
    const curr = CREDIT_ANCHORS[i];
    if (amount <= curr.amount) {
      const ratio = (amount - prev.amount) / (curr.amount - prev.amount);
      const interpolated = prev.credits + (curr.credits - prev.credits) * ratio;
      const step = amount >= 100 ? 25 : amount >= 30 ? 10 : 5;
      return Math.round(interpolated / step) * step;
    }
  }
  const prev = CREDIT_ANCHORS[CREDIT_ANCHORS.length - 2];
  const curr = CREDIT_ANCHORS[CREDIT_ANCHORS.length - 1];
  const ratio = (amount - prev.amount) / (curr.amount - prev.amount);
  const interpolated = prev.credits + (curr.credits - prev.credits) * ratio;
  const step = 25;
  return Math.round(interpolated / step) * step;
}

function creditsFromAmountCents(amountCents: number) {
  const amountDollars = amountCents / 100;
  return {
    amountDollars,
    plan: planTierFromAmount(amountDollars),
    credits: estimateCredits(amountDollars),
  };
}

// ─── Polar product IDs (mirrors apps/website/src/lib/polarProducts.ts) ───────

const POLAR_SUBSCRIPTION_ID =
  process.env.NEXT_PUBLIC_POLAR_SUBSCRIPTION_ID ||
  process.env.NEXT_PUBLIC_POLAR_PRODUCT_PAYG_ID ||
  '22f2eb79-766c-402c-9e5b-2d48c7b099fb';

// ─── Standardwebhooks signature verification ─────────────────────────────────

const WEBHOOK_TOLERANCE_SECONDS = 300;

function verifyPolarSignature(secret: string, rawBody: string, headers: Record<string, string>): { ok: boolean; reason?: string; expectedPreview?: string } {
  try {
    const msgId        = headers['webhook-id'] || '';
    const msgTimestamp = headers['webhook-timestamp'] || '';
    const msgSig       = headers['webhook-signature'] || '';

    if (!msgId || !msgTimestamp || !msgSig) {
      return { ok: false, reason: 'missing_headers' };
    }

    const ts = parseInt(msgTimestamp, 10);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS) {
      return { ok: false, reason: 'timestamp_out_of_tolerance' };
    }

    // Try several candidate HMAC key derivations — Polar / standardwebhooks
    // is fiddly enough that we'd rather match-or-explain than silently fail.
    const candidates: Array<{ label: string; key: Buffer }> = [];
    // Polar SDK behavior: HMAC key is raw UTF-8 bytes of the full secret string.
    candidates.push({ label: 'raw_utf8', key: Buffer.from(secret, 'utf8') });
    // Standardwebhooks "whsec_<base64>" format.
    if (secret.startsWith('whsec_')) {
      try { candidates.push({ label: 'whsec_b64', key: Buffer.from(secret.slice(6), 'base64') }); } catch {}
    }
    // "polar_whs_<base64>" — same shape but with Polar's prefix; some integrations
    // expect this branch.
    if (secret.startsWith('polar_whs_')) {
      try { candidates.push({ label: 'polar_b64', key: Buffer.from(secret.slice('polar_whs_'.length), 'base64') }); } catch {}
    }
    // Last resort: treat the whole thing as base64 directly.
    try { candidates.push({ label: 'b64_whole', key: Buffer.from(secret, 'base64') }); } catch {}

    const signedContent = `${msgId}.${msgTimestamp}.${rawBody}`;
    const expectedByLabel: Record<string, string> = {};
    for (const c of candidates) {
      expectedByLabel[c.label] = createHmac('sha256', c.key).update(signedContent).digest('base64');
    }

    const provided = msgSig.split(/\s+/).filter(Boolean);
    for (const entry of provided) {
      const idx = entry.indexOf(',');
      if (idx < 0) continue;
      const version = entry.slice(0, idx);
      const sig = entry.slice(idx + 1);
      if (version !== 'v1') continue;
      const sigBuf = (() => { try { return Buffer.from(sig, 'base64'); } catch { return null; } })();
      if (!sigBuf) continue;
      for (const c of candidates) {
        const exp = expectedByLabel[c.label];
        try {
          const expBuf = Buffer.from(exp, 'base64');
          if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
            return { ok: true, reason: c.label };
          }
        } catch {}
      }
    }
    const preview = candidates.map((c) => `${c.label}=${expectedByLabel[c.label].slice(0, 10)}`).join(' ');
    return { ok: false, reason: 'signature_mismatch', expectedPreview: preview };
  } catch (e: any) {
    return { ok: false, reason: `exception:${e?.message || 'unknown'}` };
  }
}

// ─── Payload helpers ──────────────────────────────────────────────────────────

function getStringCandidate(...candidates: any[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function getIsoDateCandidate(...candidates: any[]): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (Number.isFinite(d.getTime())) return d.toISOString();
  }
  return null;
}

function extractUserId(obj: any): string | null {
  return getStringCandidate(
    obj?.metadata?.userId,
    obj?.metadata?.user_id,
    obj?.checkout?.metadata?.userId,
    obj?.checkout?.metadata?.user_id,
    obj?.customer_metadata?.userId,
    obj?.customer_metadata?.user_id,
    obj?.customer?.metadata?.userId,
    obj?.customer?.metadata?.user_id,
  );
}

function extractProductId(obj: any): string | null {
  return getStringCandidate(
    obj?.productId, obj?.product_id, obj?.product?.id,
    obj?.checkout?.productId, obj?.checkout?.product_id,
    obj?.items?.[0]?.productId, obj?.items?.[0]?.product_id,
  );
}

function extractCustomerId(obj: any): string | null {
  return getStringCandidate(
    obj?.customerId, obj?.customer_id, obj?.customer?.id,
    obj?.checkout?.customerId, obj?.checkout?.customer_id,
  );
}

function extractSubscriptionId(obj: any): string | null {
  return getStringCandidate(
    obj?.subscriptionId, obj?.subscription_id, obj?.id, obj?.subscription?.id,
  );
}

function extractPeriodBounds(obj: any) {
  return {
    start: getIsoDateCandidate(
      obj?.currentPeriodStart, obj?.current_period_start,
      obj?.periodStart, obj?.period_start,
      obj?.billingPeriodStart, obj?.billing_period_start,
    ),
    end: getIsoDateCandidate(
      obj?.currentPeriodEnd, obj?.current_period_end,
      obj?.periodEnd, obj?.period_end,
      obj?.billingPeriodEnd, obj?.billing_period_end,
      obj?.endsAt, obj?.ends_at,
    ),
  };
}

function getAmountCents(payload: any): number | null {
  const candidates = [
    payload?.amount,
    payload?.price?.amount,
    payload?.price?.amount_cents,
    payload?.price?.amountCents,
    payload?.items?.[0]?.price?.amount,
    payload?.items?.[0]?.amount,
    payload?.checkout?.amount,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function planFromProductId(productId: string | null | undefined): PlanTier | null {
  if (!productId) return null;
  if (productId === POLAR_SUBSCRIPTION_ID) return null;
  const starter = process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_ID || '';
  const pro     = process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_ID     || '';
  const power   = process.env.NEXT_PUBLIC_POLAR_PRODUCT_POWER_ID   || '';
  const free    = process.env.NEXT_PUBLIC_POLAR_PRODUCT_FREE_ID    || '';
  if (starter && productId === starter) return 'starter';
  if (pro     && productId === pro)     return 'pro';
  if (power   && productId === power)   return 'power';
  if (free    && productId === free)    return 'free';
  return null;
}

// ─── Supabase writes ──────────────────────────────────────────────────────────

async function updateProfile(userId: string, values: Record<string, any>) {
  const sb = getSupabaseAdmin();
  if (!sb) { writeLog('polar_webhook_no_supabase', {}); return; }
  const { error } = await sb.from('profiles').update(values).eq('user_id', userId);
  if (error) await sb.from('profiles').update(values).eq('id', userId);
}

async function upsertCreditGrant(input: {
  userId: string;
  sourceType: GrantSourceType;
  sourceRef: string;
  plan?: string | null;
  amountUsd?: number | null;
  totalCredits: number;
  expiresAt?: string | null;
  metadata?: any;
}) {
  const sb = getSupabaseAdmin();
  if (!sb) return;
  const totalCredits = Math.max(0, Number(input.totalCredits || 0));
  if (!totalCredits) return;

  const { data: existing } = await sb
    .from('credit_grants')
    .select('id, total_credits, remaining_credits')
    .eq('user_id', input.userId)
    .eq('source_type', input.sourceType)
    .eq('source_ref', input.sourceRef)
    .maybeSingle();

  let grantId: string | null = null;
  if (existing?.id) {
    const consumed = Math.max(0, (Number(existing.total_credits) || 0) - (Number(existing.remaining_credits) || 0));
    const { data } = await sb
      .from('credit_grants')
      .update({
        plan: input.plan || null,
        amount_usd: input.amountUsd ?? null,
        total_credits: totalCredits,
        remaining_credits: Math.max(0, totalCredits - consumed),
        expires_at: input.expiresAt ?? null,
        metadata: input.metadata || {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id')
      .single();
    grantId = data?.id ?? null;
  } else {
    const { data } = await sb
      .from('credit_grants')
      .insert({
        user_id: input.userId,
        source_type: input.sourceType,
        source_ref: input.sourceRef,
        plan: input.plan || null,
        amount_usd: input.amountUsd ?? null,
        total_credits: totalCredits,
        remaining_credits: totalCredits,
        expires_at: input.expiresAt ?? null,
        metadata: input.metadata || {},
      })
      .select('id')
      .single();
    grantId = data?.id ?? null;
  }

  if (grantId) {
    await sb.from('credit_transactions').upsert({
      user_id: input.userId,
      grant_id: grantId,
      entry_type: 'grant',
      source_type: input.sourceType,
      source_ref: input.sourceRef,
      credits: totalCredits,
      amount_usd: input.amountUsd ?? null,
      metadata: input.metadata || {},
    }, { onConflict: 'user_id,grant_id,entry_type,source_type,source_ref' });
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function applySubscriptionGrant(userId: string, payload: any, status: string) {
  const amountCents    = getAmountCents(payload);
  const productId      = extractProductId(payload);
  const subscriptionId = extractSubscriptionId(payload);
  const period         = extractPeriodBounds(payload);
  const amount         = amountCents ? creditsFromAmountCents(amountCents) : null;
  const plan           = planFromProductId(productId) || amount?.plan || 'starter';
  const sourceRef      = `${subscriptionId || productId || 'subscription'}:${period.end || period.start || 'current'}`;

  if (amount) {
    await upsertCreditGrant({
      userId,
      sourceType: 'subscription_cycle',
      sourceRef,
      plan,
      amountUsd: amount.amountDollars,
      totalCredits: amount.credits,
      expiresAt: period.end,
      metadata: { productId, subscriptionId, currentPeriodStart: period.start, currentPeriodEnd: period.end },
    });
  }

  const values: Record<string, any> = {
    plan,
    billing_customer_id: extractCustomerId(payload),
    billing_subscription_id: subscriptionId,
    billing_product_id: productId,
    billing_subscription_status: status,
    current_period_start: period.start,
    current_period_end: period.end,
  };
  if (amount) values.monthly_token_limit = amount.credits;
  await updateProfile(userId, values);
}

async function applyAddonGrant(userId: string, payload: any) {
  const amountCents = getAmountCents(payload);
  if (!amountCents) return;
  const amount    = creditsFromAmountCents(amountCents);
  const productId = extractProductId(payload);
  const orderRef  = getStringCandidate(
    payload?.orderId, payload?.order_id, payload?.id,
    payload?.checkout?.id, payload?.checkout_id,
  ) || `${productId || 'addon'}:${amountCents}`;
  await upsertCreditGrant({
    userId,
    sourceType: 'addon_purchase',
    sourceRef: orderRef,
    amountUsd: amount.amountDollars,
    totalCredits: amount.credits,
    metadata: { productId, orderId: orderRef },
  });
}

async function handlePolarEvent(eventType: string, payload: any) {
  const userId = extractUserId(payload);
  if (!userId) {
    writeLog('polar_webhook_no_user', { eventType });
    return;
  }

  switch (eventType) {
    case 'order.paid': {
      // Skip subscription-cycle orders — handled by subscription.* events
      const isSub = !!getStringCandidate(payload?.subscriptionId, payload?.subscription_id, payload?.subscription?.id);
      if (isSub) return;
      await applyAddonGrant(userId, payload);
      break;
    }
    case 'subscription.active':
    case 'subscription.updated': {
      const status = getStringCandidate(payload?.status, payload?.subscription?.status) || 'active';
      await applySubscriptionGrant(userId, payload, status);
      break;
    }
    case 'subscription.canceled': {
      const period = extractPeriodBounds(payload);
      await updateProfile(userId, {
        billing_customer_id: extractCustomerId(payload),
        billing_subscription_id: extractSubscriptionId(payload),
        billing_product_id: extractProductId(payload),
        billing_subscription_status: 'canceled',
        current_period_start: period.start,
        current_period_end: period.end,
      });
      break;
    }
    case 'subscription.revoked': {
      await updateProfile(userId, {
        plan: 'free',
        monthly_token_limit: 0,
        billing_customer_id: extractCustomerId(payload),
        billing_subscription_id: extractSubscriptionId(payload),
        billing_product_id: extractProductId(payload),
        billing_subscription_status: 'revoked',
      });
      break;
    }
    default:
      writeLog('polar_webhook_unhandled', { eventType });
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function handlePolarWebhook(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (req.method !== 'POST' || parsedUrl.pathname !== '/api/webhook') return false;

  // Trim — Secret Manager values frequently have a trailing newline that
  // silently breaks HMAC verification.
  const secret = (process.env.POLAR_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    res.writeHead(500).end(JSON.stringify({ ok: false, error: 'missing_polar_webhook_secret' }));
    return true;
  }

  // Collect raw body
  const raw = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k] = v;
    else if (Array.isArray(v)) headers[k] = v[0];
  }

  const verify = verifyPolarSignature(secret, raw, headers);
  if (!verify.ok) {
    // TEMP debug: emit to stderr so it lands in Cloud Run logs alongside the
    // request, and include enough material to diagnose without exposing the
    // secret or full body. Remove once verification is working.
    const dbg = {
      reason: verify.reason,
      ip: req.socket?.remoteAddress,
      secretLen: secret.length,
      secretPrefix: secret.slice(0, 10),
      bodyLen: raw.length,
      bodyHead: raw.slice(0, 80),
      bodyTail: raw.slice(-40),
      headerId: headers['webhook-id'],
      headerTs: headers['webhook-timestamp'],
      headerSigPrefix: (headers['webhook-signature'] || '').slice(0, 16),
      computedSigPrefix: verify.expectedPreview,
    };
    try { console.error('[polar_webhook_bad_signature]', JSON.stringify(dbg)); } catch {}
    writeLog('polar_webhook_bad_signature', dbg);
    res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'invalid_signature', reason: verify.reason }));
    return true;
  }

  let body: any;
  try { body = JSON.parse(raw); } catch {
    res.writeHead(400).end(JSON.stringify({ ok: false, error: 'invalid_json' }));
    return true;
  }

  // Polar wraps events as { type, data } or sends the object directly
  const eventType: string = body?.type || '';
  const payload           = body?.data ?? body;

  try {
    await handlePolarEvent(eventType, payload);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
  } catch (e: any) {
    writeLog('polar_webhook_error', { eventType, error: e?.message });
    res.writeHead(500).end(JSON.stringify({ ok: false, error: 'internal_error' }));
  }

  return true;
}
