/**
 * Core Webhook System
 * Handles webhook registration, verification, and dispatch
 */

import crypto from 'crypto';
import { getSupabaseService } from '../supabase';
import { writeLog } from '../utils/logger';

// Types
export interface Webhook {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description?: string;
  type: 'workflow' | 'custom' | 'integration';
  target_workflow_id?: string;
  target_workflow_trigger_id?: string;
  secret: string;
  allowed_ips?: string[];
  require_signature: boolean;
  is_active: boolean;
  last_triggered_at?: string;
  trigger_count: number;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  webhook_id?: string;
  user_id: string;
  source_ip?: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query_params: Record<string, string>;
  body: any;
  raw_body: string;
  status: 'received' | 'verified' | 'processing' | 'delivered' | 'failed' | 'rejected';
  error_message?: string;
  response_status?: number;
  response_body?: any;
  delivered_to?: string;
  delivery_attempts: number;
  delivered_at?: string;
  processed_at?: string;
  created_at: string;
}

export interface WebhookProvider {
  id: string;
  user_id: string;
  provider: 'stripe' | 'twilio' | 'github' | 'sendgrid' | 'slack' | string;
  name?: string;
  webhook_secret?: string;
  config: Record<string, any>;
  event_mappings: Record<string, { workflow_id?: string; action?: string }>;
  is_active: boolean;
  last_event_at?: string;
  event_count: number;
  created_at: string;
  updated_at: string;
}

// Generate secure webhook secret
export function generateWebhookSecret(): string {
  return 'whsec_' + crypto.randomBytes(32).toString('hex');
}

// Generate URL-safe slug
export function generateWebhookSlug(): string {
  return 'wh_' + crypto.randomBytes(12).toString('base64url');
}

// Verify HMAC signature
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm: 'sha256' | 'sha1' = 'sha256'
): boolean {
  try {
    const hmac = crypto.createHmac(algorithm, secret);
    hmac.update(payload);
    const expected = hmac.digest('hex');
    
    // Support various signature formats
    const normalized = signature
      .replace(/^sha256=/, '')
      .replace(/^sha1=/, '')
      .replace(/^v1=/, '')
      .toLowerCase();
    
    return crypto.timingSafeEqual(
      Buffer.from(normalized, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

// Parse Stripe signature header
export function parseStripeSignature(header: string): { timestamp: string; v1: string } | null {
  try {
    const parts: Record<string, string> = {};
    for (const part of header.split(',')) {
      const [key, value] = part.split('=');
      if (key && value) parts[key.trim()] = value.trim();
    }
    if (parts.t && parts.v1) {
      return { timestamp: parts.t, v1: parts.v1 };
    }
    return null;
  } catch {
    return null;
  }
}

// Verify Stripe webhook signature
export function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string,
  tolerance = 300 // 5 minutes
): boolean {
  try {
    const parsed = parseStripeSignature(signature);
    if (!parsed) return false;
    
    const timestamp = parseInt(parsed.timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    
    if (Math.abs(now - timestamp) > tolerance) {
      return false; // Too old
    }
    
    const signedPayload = `${parsed.timestamp}.${payload}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(signedPayload);
    const expected = hmac.digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(parsed.v1, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

// Verify Twilio request signature
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string
): boolean {
  try {
    // Sort params and concatenate
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }
    
    const hmac = crypto.createHmac('sha1', authToken);
    hmac.update(data);
    const expected = hmac.digest('base64');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'base64'),
      Buffer.from(expected, 'base64')
    );
  } catch {
    return false;
  }
}

// Database operations
export async function getWebhookBySlug(slug: string): Promise<Webhook | null> {
  const supabase = getSupabaseService();
  if (!supabase) return null;
  
  try {
    const { data, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();
    
    if (error || !data) return null;
    return data as Webhook;
  } catch {
    return null;
  }
}

export async function getWebhooksByUser(userId: string): Promise<Webhook[]> {
  const supabase = getSupabaseService();
  if (!supabase) return [];
  
  try {
    const { data, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error || !data) return [];
    return data as Webhook[];
  } catch {
    return [];
  }
}

export async function createWebhook(
  userId: string,
  input: {
    name: string;
    slug?: string;
    description?: string;
    type?: 'workflow' | 'custom' | 'integration';
    target_workflow_id?: string;
    target_workflow_trigger_id?: string;
    require_signature?: boolean;
    allowed_ips?: string[];
    is_active?: boolean;
    metadata?: Record<string, any>;
  }
): Promise<Webhook | null> {
  const supabase = getSupabaseService();
  if (!supabase) return null;
  
  const slug = input.slug || generateWebhookSlug();
  const secret = generateWebhookSecret();
  
  try {
    const { data, error } = await supabase
      .from('webhooks')
      .insert({
        user_id: userId,
        name: input.name,
        slug,
        description: input.description || null,
        type: input.type || 'custom',
        target_workflow_id: input.target_workflow_id || null,
        target_workflow_trigger_id: input.target_workflow_trigger_id || null,
        secret,
        require_signature: input.require_signature ?? false,
        allowed_ips: input.allowed_ips || null,
        is_active: input.is_active ?? true,
        metadata: input.metadata || {},
      })
      .select()
      .single();
    
    if (error || !data) {
      writeLog('webhook_create_error', { userId, error: error?.message });
      return null;
    }
    
    writeLog('webhook_created', { userId, slug, type: input.type });
    return data as Webhook;
  } catch (e: any) {
    writeLog('webhook_create_exception', { userId, error: e?.message });
    return null;
  }
}

export async function updateWebhook(
  userId: string,
  webhookId: string,
  updates: Partial<Pick<Webhook, 'name' | 'description' | 'is_active' | 'require_signature' | 'allowed_ips' | 'target_workflow_id' | 'target_workflow_trigger_id' | 'metadata'>>
): Promise<boolean> {
  const supabase = getSupabaseService();
  if (!supabase) return false;
  
  try {
    const { error } = await supabase
      .from('webhooks')
      .update(updates)
      .eq('id', webhookId)
      .eq('user_id', userId);
    
    return !error;
  } catch {
    return false;
  }
}

export async function deleteWebhook(userId: string, webhookId: string): Promise<boolean> {
  const supabase = getSupabaseService();
  if (!supabase) return false;
  
  try {
    const { error } = await supabase
      .from('webhooks')
      .delete()
      .eq('id', webhookId)
      .eq('user_id', userId);
    
    return !error;
  } catch {
    return false;
  }
}

export async function regenerateWebhookSecret(userId: string, webhookId: string): Promise<string | null> {
  const supabase = getSupabaseService();
  if (!supabase) return null;
  
  const newSecret = generateWebhookSecret();
  
  try {
    const { error } = await supabase
      .from('webhooks')
      .update({ secret: newSecret })
      .eq('id', webhookId)
      .eq('user_id', userId);
    
    if (error) return null;
    return newSecret;
  } catch {
    return null;
  }
}

// Event logging
export async function logWebhookEvent(event: Omit<WebhookEvent, 'id' | 'created_at'>): Promise<string | null> {
  const supabase = getSupabaseService();
  if (!supabase) return null;
  
  try {
    const { data, error } = await supabase
      .from('webhook_events')
      .insert(event)
      .select('id')
      .single();
    
    if (error || !data) return null;
    return (data as any).id;
  } catch {
    return null;
  }
}

export async function updateWebhookEvent(
  eventId: string,
  updates: Partial<Pick<WebhookEvent, 'status' | 'error_message' | 'response_status' | 'response_body' | 'delivered_to' | 'delivered_at' | 'processed_at'>>
): Promise<boolean> {
  const supabase = getSupabaseService();
  if (!supabase) return false;
  
  try {
    const { error } = await supabase
      .from('webhook_events')
      .update(updates)
      .eq('id', eventId);
    
    return !error;
  } catch {
    return false;
  }
}

export async function getWebhookEvents(
  userId: string,
  options?: { webhookId?: string; limit?: number; status?: string }
): Promise<WebhookEvent[]> {
  const supabase = getSupabaseService();
  if (!supabase) return [];
  
  try {
    let query = supabase
      .from('webhook_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(options?.limit || 50);
    
    if (options?.webhookId) {
      query = query.eq('webhook_id', options.webhookId);
    }
    if (options?.status) {
      query = query.eq('status', options.status);
    }
    
    const { data, error } = await query;
    if (error || !data) return [];
    return data as WebhookEvent[];
  } catch {
    return [];
  }
}

// Provider operations
export async function getProviderConfig(userId: string, provider: string): Promise<WebhookProvider | null> {
  const supabase = getSupabaseService();
  if (!supabase) return null;
  
  try {
    const { data, error } = await supabase
      .from('webhook_providers')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();
    
    if (error || !data) return null;
    return data as WebhookProvider;
  } catch {
    return null;
  }
}

export async function upsertProviderConfig(
  userId: string,
  provider: string,
  config: {
    name?: string;
    webhook_secret?: string;
    config?: Record<string, any>;
    event_mappings?: Record<string, { workflow_id?: string; action?: string }>;
    is_active?: boolean;
  }
): Promise<boolean> {
  const supabase = getSupabaseService();
  if (!supabase) return false;
  
  try {
    const { error } = await supabase
      .from('webhook_providers')
      .upsert({
        user_id: userId,
        provider,
        ...config,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,provider' });
    
    return !error;
  } catch {
    return false;
  }
}

// Queue operations for offline delivery
export async function queueWebhookDelivery(
  userId: string,
  webhookId: string | null,
  eventId: string,
  payload: any
): Promise<boolean> {
  const supabase = getSupabaseService();
  if (!supabase) return false;
  
  try {
    const { error } = await supabase
      .from('webhook_queue')
      .insert({
        user_id: userId,
        webhook_id: webhookId,
        event_id: eventId,
        payload,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      });
    
    return !error;
  } catch {
    return false;
  }
}

export async function getPendingDeliveries(userId: string, limit = 50): Promise<Array<{
  id: string;
  webhook_id: string | null;
  event_id: string;
  payload: any;
  created_at: string;
}>> {
  const supabase = getSupabaseService();
  if (!supabase) return [];
  
  try {
    const { data, error } = await supabase
      .from('webhook_queue')
      .select('id, webhook_id, event_id, payload, created_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(limit);
    
    if (error || !data) return [];
    return data as any;
  } catch {
    return [];
  }
}

export async function markDelivered(queueId: string): Promise<boolean> {
  const supabase = getSupabaseService();
  if (!supabase) return false;
  
  try {
    const { error } = await supabase
      .from('webhook_queue')
      .update({ status: 'delivered', last_attempt_at: new Date().toISOString() })
      .eq('id', queueId);
    
    return !error;
  } catch {
    return false;
  }
}
