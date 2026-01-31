import type { IncomingMessage, ServerResponse } from 'http';
import { writeLog } from '../utils/logger';
import { verifyToken } from '../supabase';
import { processIncomingWebhook } from '../webhooks/dispatch';
import { 
  getWebhooksByUser, 
  createWebhook, 
  updateWebhook, 
  deleteWebhook, 
  regenerateWebhookSecret,
  getWebhookEvents,
  getProviderConfig,
  upsertProviderConfig,
} from '../webhooks/core';
import { handleStripeWebhook, extractUserIdFromStripeEvent } from '../webhooks/providers/stripe';
import { handleTwilioSmsWebhook, handleTwilioStatusCallback, handleTwilioVoiceWebhook } from '../webhooks/providers/twilio';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Signature, X-Twilio-Signature, Stripe-Signature',
};

function sendJson(res: ServerResponse, status: number, data: any) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 
    'Content-Type': 'application/json', 
    'Content-Length': Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
}

function sendTwiml(res: ServerResponse, twiml: string) {
  res.writeHead(200, {
    'Content-Type': 'application/xml',
    'Content-Length': Buffer.byteLength(twiml),
    ...CORS_HEADERS,
  });
  res.end(twiml);
}

async function readBody(req: IncomingMessage): Promise<{ raw: string; parsed: any }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let parsed: any = raw;
      try { parsed = JSON.parse(raw); } catch {}
      resolve({ raw, parsed });
    });
    req.on('error', () => resolve({ raw: '', parsed: {} }));
  });
}

function getHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value[0];
  }
  return headers;
}

function getSourceIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  if (Array.isArray(xff)) return xff[0].split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function authenticateRequest(req: IncomingMessage): Promise<{ userId: string } | null> {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const user = await verifyToken(token);
  return user ? { userId: user.userId } : null;
}

export async function handleWebhooks(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const method = req.method || 'GET';
  const pathname = parsedUrl.pathname || '';
  
  // Handle CORS preflight
  if (method === 'OPTIONS' && pathname.startsWith('/webhooks')) {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return true;
  }
  
  // ============================================
  // Incoming webhooks (user-created endpoints)
  // POST /webhooks/incoming/:slug
  // ============================================
  if (method === 'POST' && pathname.startsWith('/webhooks/incoming/')) {
    const slug = pathname.replace('/webhooks/incoming/', '').split('/')[0];
    if (!slug) {
      sendJson(res, 400, { ok: false, error: 'missing_slug' });
      return true;
    }
    
    try {
      const { raw, parsed } = await readBody(req);
      const headers = getHeaders(req);
      const sourceIp = getSourceIp(req);
      const signature = headers['x-signature'] || headers['x-hub-signature-256'] || '';
      const queryParams: Record<string, string> = {};
      parsedUrl.searchParams.forEach((v, k) => { queryParams[k] = v; });
      
      const result = await processIncomingWebhook(slug, parsed, raw, headers, queryParams, sourceIp, signature);
      
      if (!result.ok) {
        const status = result.error === 'webhook_not_found' ? 404 : 
                       result.error === 'webhook_inactive' ? 410 :
                       result.error === 'ip_not_allowed' || result.error === 'invalid_signature' ? 403 : 400;
        sendJson(res, status, { ok: false, error: result.error });
        return true;
      }
      
      sendJson(res, 200, { 
        ok: true, 
        eventId: result.eventId,
        delivered: result.delivered,
        queued: result.queued,
      });
      return true;
    } catch (e: any) {
      writeLog('webhook_error', { slug, error: e?.message });
      sendJson(res, 500, { ok: false, error: 'internal_error' });
      return true;
    }
  }
  
  // ============================================
  // Stripe webhooks
  // POST /webhooks/stripe
  // ============================================
  if (method === 'POST' && pathname === '/webhooks/stripe') {
    try {
      const { raw, parsed } = await readBody(req);
      const headers = getHeaders(req);
      const signature = headers['stripe-signature'] || '';
      const sourceIp = getSourceIp(req);
      
      // Try to find user from event metadata
      let userId = extractUserIdFromStripeEvent(parsed);
      
      // If no user ID in event, check query param (for testing)
      if (!userId) {
        userId = parsedUrl.searchParams.get('user_id') || null;
      }
      
      if (!userId) {
        // Log anyway with null user for debugging
        writeLog('stripe_webhook_no_user', { eventType: parsed?.type });
        sendJson(res, 200, { ok: true, warning: 'no_user_id' });
        return true;
      }
      
      const result = await handleStripeWebhook(userId, raw, signature, headers, sourceIp);
      sendJson(res, result.ok ? 200 : 400, result);
      return true;
    } catch (e: any) {
      writeLog('stripe_webhook_error', { error: e?.message });
      sendJson(res, 500, { ok: false, error: 'internal_error' });
      return true;
    }
  }
  
  // ============================================
  // Twilio SMS webhook
  // POST /webhooks/twilio/sms
  // ============================================
  if (method === 'POST' && pathname === '/webhooks/twilio/sms') {
    try {
      const { raw, parsed } = await readBody(req);
      const headers = getHeaders(req);
      const signature = headers['x-twilio-signature'] || '';
      const sourceIp = getSourceIp(req);
      
      // Parse form data if needed
      let params: Record<string, string> = {};
      if (typeof parsed === 'string') {
        // URL-encoded form data
        const sp = new URLSearchParams(parsed);
        sp.forEach((v, k) => { params[k] = v; });
      } else {
        params = parsed;
      }
      
      // Get user ID from query param (configured in Twilio webhook URL)
      const userId = parsedUrl.searchParams.get('user_id');
      if (!userId) {
        sendJson(res, 400, { ok: false, error: 'missing_user_id' });
        return true;
      }
      
      const fullUrl = `${process.env.CLOUD_PUBLIC_URL || 'https://api.stuard.ai'}${pathname}`;
      const result = await handleTwilioSmsWebhook(userId, params, fullUrl, signature, headers, sourceIp);
      
      // Return TwiML response
      if (result.twiml) {
        sendTwiml(res, result.twiml);
      } else {
        sendJson(res, result.ok ? 200 : 400, result);
      }
      return true;
    } catch (e: any) {
      writeLog('twilio_sms_error', { error: e?.message });
      sendJson(res, 500, { ok: false, error: 'internal_error' });
      return true;
    }
  }
  
  // ============================================
  // Twilio Status callback
  // POST /webhooks/twilio/status
  // ============================================
  if (method === 'POST' && pathname === '/webhooks/twilio/status') {
    try {
      const { parsed } = await readBody(req);
      const headers = getHeaders(req);
      const signature = headers['x-twilio-signature'] || '';
      const sourceIp = getSourceIp(req);
      
      let params: Record<string, string> = {};
      if (typeof parsed === 'string') {
        const sp = new URLSearchParams(parsed);
        sp.forEach((v, k) => { params[k] = v; });
      } else {
        params = parsed;
      }
      
      const userId = parsedUrl.searchParams.get('user_id');
      if (!userId) {
        sendJson(res, 200, { ok: true }); // Don't fail status callbacks
        return true;
      }
      
      const fullUrl = `${process.env.CLOUD_PUBLIC_URL || 'https://api.stuard.ai'}${pathname}`;
      const result = await handleTwilioStatusCallback(userId, params, fullUrl, signature, headers, sourceIp);
      sendJson(res, 200, result);
      return true;
    } catch (e: any) {
      sendJson(res, 200, { ok: true }); // Don't fail status callbacks
      return true;
    }
  }
  
  // ============================================
  // Twilio Voice webhook
  // POST /webhooks/twilio/voice
  // ============================================
  if (method === 'POST' && pathname === '/webhooks/twilio/voice') {
    try {
      const { parsed } = await readBody(req);
      const headers = getHeaders(req);
      const signature = headers['x-twilio-signature'] || '';
      const sourceIp = getSourceIp(req);
      
      let params: Record<string, string> = {};
      if (typeof parsed === 'string') {
        const sp = new URLSearchParams(parsed);
        sp.forEach((v, k) => { params[k] = v; });
      } else {
        params = parsed;
      }
      
      const userId = parsedUrl.searchParams.get('user_id');
      if (!userId) {
        // Return a default TwiML
        sendTwiml(res, '<?xml version="1.0" encoding="UTF-8"?><Response><Say>This number is not configured.</Say></Response>');
        return true;
      }
      
      const fullUrl = `${process.env.CLOUD_PUBLIC_URL || 'https://api.stuard.ai'}${pathname}`;
      const result = await handleTwilioVoiceWebhook(userId, params, fullUrl, signature, headers, sourceIp);
      
      if (result.twiml) {
        sendTwiml(res, result.twiml);
      } else {
        sendJson(res, result.ok ? 200 : 400, result);
      }
      return true;
    } catch (e: any) {
      sendTwiml(res, '<?xml version="1.0" encoding="UTF-8"?><Response><Say>An error occurred.</Say></Response>');
      return true;
    }
  }
  
  // ============================================
  // Webhook Management API (authenticated)
  // ============================================
  
  // GET /v1/webhooks - List user's webhooks
  if (method === 'GET' && pathname === '/v1/webhooks') {
    const auth = await authenticateRequest(req);
    if (!auth) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    
    const webhooks = await getWebhooksByUser(auth.userId);
    // Hide secrets in response
    const safe = webhooks.map(w => ({ ...w, secret: w.secret.slice(0, 12) + '...' }));
    sendJson(res, 200, { ok: true, webhooks: safe });
    return true;
  }
  
  // POST /v1/webhooks - Create a webhook
  if (method === 'POST' && pathname === '/v1/webhooks') {
    const auth = await authenticateRequest(req);
    if (!auth) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    
    const { parsed } = await readBody(req);
    if (!parsed?.name) {
      sendJson(res, 400, { ok: false, error: 'name_required' });
      return true;
    }
    
    const webhook = await createWebhook(auth.userId, {
      name: parsed.name,
      slug: parsed.slug,
      description: parsed.description,
      type: parsed.type,
      target_workflow_id: parsed.workflowId,
      target_workflow_trigger_id: parsed.triggerId,
      require_signature: parsed.requireSignature,
      allowed_ips: parsed.allowedIps,
      metadata: parsed.metadata,
    });
    
    if (!webhook) {
      sendJson(res, 500, { ok: false, error: 'create_failed' });
      return true;
    }
    
    const baseUrl = process.env.CLOUD_PUBLIC_URL || 'https://api.stuard.ai';
    sendJson(res, 201, { 
      ok: true, 
      webhook,
      url: `${baseUrl}/webhooks/incoming/${webhook.slug}`,
    });
    return true;
  }
  
  // PUT /v1/webhooks/:id - Update a webhook
  if (method === 'PUT' && pathname.startsWith('/v1/webhooks/')) {
    const auth = await authenticateRequest(req);
    if (!auth) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    
    const webhookId = pathname.replace('/v1/webhooks/', '');
    const { parsed } = await readBody(req);
    
    const success = await updateWebhook(auth.userId, webhookId, parsed);
    sendJson(res, success ? 200 : 400, { ok: success });
    return true;
  }
  
  // DELETE /v1/webhooks/:id - Delete a webhook
  if (method === 'DELETE' && pathname.startsWith('/v1/webhooks/')) {
    const auth = await authenticateRequest(req);
    if (!auth) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    
    const webhookId = pathname.replace('/v1/webhooks/', '');
    const success = await deleteWebhook(auth.userId, webhookId);
    sendJson(res, success ? 200 : 400, { ok: success });
    return true;
  }
  
  // POST /v1/webhooks/:id/regenerate-secret
  if (method === 'POST' && pathname.match(/^\/v1\/webhooks\/[^/]+\/regenerate-secret$/)) {
    const auth = await authenticateRequest(req);
    if (!auth) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    
    const webhookId = pathname.split('/')[3];
    const newSecret = await regenerateWebhookSecret(auth.userId, webhookId);
    
    if (!newSecret) {
      sendJson(res, 400, { ok: false, error: 'regenerate_failed' });
      return true;
    }
    
    sendJson(res, 200, { ok: true, secret: newSecret });
    return true;
  }
  
  // GET /v1/webhooks/:id/events - Get webhook events
  if (method === 'GET' && pathname.match(/^\/v1\/webhooks\/[^/]+\/events$/)) {
    const auth = await authenticateRequest(req);
    if (!auth) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    
    const webhookId = pathname.split('/')[3];
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50');
    const status = parsedUrl.searchParams.get('status') || undefined;
    
    const events = await getWebhookEvents(auth.userId, { webhookId, limit, status });
    sendJson(res, 200, { ok: true, events });
    return true;
  }
  
  // ============================================
  // Provider Configuration API
  // ============================================
  
  // GET /v1/webhooks/providers/:provider
  if (method === 'GET' && pathname.match(/^\/v1\/webhooks\/providers\/[^/]+$/)) {
    const auth = await authenticateRequest(req);
    if (!auth) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    
    const provider = pathname.split('/').pop() || '';
    const config = await getProviderConfig(auth.userId, provider);
    
    if (config) {
      // Hide secret
      sendJson(res, 200, { 
        ok: true, 
        config: { ...config, webhook_secret: config.webhook_secret ? '***' : null } 
      });
    } else {
      sendJson(res, 404, { ok: false, error: 'not_configured' });
    }
    return true;
  }
  
  // PUT /v1/webhooks/providers/:provider
  if (method === 'PUT' && pathname.match(/^\/v1\/webhooks\/providers\/[^/]+$/)) {
    const auth = await authenticateRequest(req);
    if (!auth) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    
    const provider = pathname.split('/').pop() || '';
    const { parsed } = await readBody(req);
    
    const success = await upsertProviderConfig(auth.userId, provider, {
      name: parsed.name,
      webhook_secret: parsed.webhookSecret,
      config: parsed.config,
      event_mappings: parsed.eventMappings,
      is_active: parsed.isActive ?? true,
    });
    
    sendJson(res, success ? 200 : 400, { ok: success });
    return true;
  }
  
  return false;
}
