import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { estimateCostUsd, monthlyCreditLimitForPlan, creditsFromUsd, creditsPerUsd } from './pricing';
import { DEV_MODE } from './utils/config';
import { embedMany } from 'ai';
import { ModelRouterEmbeddingModel } from '@mastra/core';
import { DEFAULT_EMBEDDER } from './utils/config';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
// Prefer new key names, fall back to legacy
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabaseAnon: SupabaseClient | null = null;
let supabaseService: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
  supabaseAnon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
}

export async function setConversationTitle(userId: string, conversationId: string, title: string): Promise<void> {
  if (!supabaseService) return;
  const t = String(title || '').trim().slice(0, 80);
  if (!t) return;
  try {
    await supabaseService
      .from('conversations')
      .update({ title: t })
      .eq('id', conversationId)
      .eq('user_id', userId);
  } catch {}
}

// Enqueue a memory job for the desktop to consume via Realtime
export async function enqueueMemoryJob(input: {
  userId: string;
  texts: string[];
  roles?: Array<'user' | 'assistant'>;
  threadId?: string | null;
  deviceId?: string | null;
}): Promise<void> {
  if (!supabaseService) return;
  const texts = Array.isArray(input.texts) ? input.texts.filter((s) => typeof s === 'string' && s.trim()) : [];
  if (texts.length === 0) return;
  try {
    const embedder = new ModelRouterEmbeddingModel(DEFAULT_EMBEDDER);
    const { embeddings } = await embedMany({ model: embedder as any, values: texts });
    const items = texts.map((t, i) => ({
      text: String(t),
      vector: embeddings[i] as number[],
      owner: input.userId,
      threadId: input.threadId || undefined,
    }));
    await supabaseService
      .from('memory_queue')
      .insert([{ user_id: input.userId, device_id: input.deviceId || null, action: 'store', payload: { items } }]);
  } catch {}
}

// External accounts (OAuth tokens) -------------------------------------------
export type ExternalAccount = {
  id: string;
  user_id: string;
  provider: string;
  scopes: string[];
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  meta?: any;
};

export async function getExternalAccount(userId: string, provider: string): Promise<ExternalAccount | null> {
  if (!supabaseService) return null;
  try {
    const { data, error } = await supabaseService
      .from('external_accounts')
      .select('id, user_id, provider, scopes, access_token, refresh_token, expires_at, meta')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();
    if (error || !data) return null;
    return data as any;
  } catch {
    return null;
  }
}

export async function upsertExternalAccount(input: {
  userId: string;
  provider: string;
  access_token: string;
  scopes?: string[];
  refresh_token?: string | null;
  expires_at?: string | null;
  meta?: any;
}): Promise<void> {
  if (!supabaseService) return;
  try {
    const values: any = {
      user_id: input.userId,
      provider: input.provider,
      access_token: input.access_token,
      scopes: Array.isArray(input.scopes) ? input.scopes : [],
      refresh_token: input.refresh_token ?? null,
      expires_at: input.expires_at ?? null,
      meta: input.meta ?? null,
      updated_at: new Date().toISOString(),
    };
    // Upsert by (user_id, provider)
    await supabaseService
      .from('external_accounts')
      .upsert(values, { onConflict: 'user_id,provider' });
  } catch {}
}

export async function getExternalAccessToken(userId: string, provider: string): Promise<string | null> {
  const acc = await getExternalAccount(userId, provider);
  return acc?.access_token || null;
}
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  supabaseService = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
}

export async function verifyToken(token: string): Promise<{ userId: string; email?: string } | null> {
  if (!token || !supabaseAnon) return null;
  try {
    const { data, error } = await supabaseAnon.auth.getUser(token);
    if (error || !data?.user) return null;
    return { userId: data.user.id, email: data.user.email || undefined };
  } catch {
    return null;
  }
}

// Start a new automation run and record the user's first message
export async function createConversation(
  userId: string,
  firstMessage: string,
  model: string,
  firstMessageMetadata?: MessageMetadata
): Promise<string | null> {
  if (!supabaseService) return null;
  try {
    // Create a conversation and attach the first user message
    const { data: conv, error: convErr } = await supabaseService
      .from('conversations')
      .insert([{ user_id: userId, model, status: 'started' }])
      .select('id')
      .single();
    if (convErr || !conv?.id) return null;
    const conversationId = conv.id as string;
    await supabaseService.from('messages').insert([
      {
        conversation_id: conversationId,
        user_id: userId,
        role: 'user',
        content: firstMessage,
        metadata: firstMessageMetadata || null,
      },
    ]);
    return conversationId;
  } catch {
    return null;
  }
}

export interface MessageMetadata {
  reasoning?: string;
  reasoningDuration?: number;
  // Model selection context (persisted so history reload can display what was requested/used)
  mode?: string;
  tier?: string;
  modelId?: string;
  toolCalls?: Array<{
    id: string;
    tool: string;
    status: string;
    args?: any;
    result?: any;
    timestamp: number;
  }>;
  streamChunks?: Array<
    | { type: 'text'; content: string }
    | { type: 'reasoning'; content: string }
    | { type: 'tool'; tool: any }
  >;
}

export async function addAssistantMessage(
  userId: string, 
  conversationId: string, 
  text: string,
  metadata?: MessageMetadata
): Promise<void> {
  if (!supabaseService) return;
  try {
    await supabaseService.from('messages').insert([
      { 
        conversation_id: conversationId, 
        user_id: userId, 
        role: 'assistant', 
        content: text,
        metadata: metadata || null,
      },
    ]);
  } catch {}
}

export async function addUserMessage(
  userId: string,
  conversationId: string,
  text: string,
  metadata?: MessageMetadata
): Promise<void> {
  if (!supabaseService) return;
  try {
    await supabaseService.from('messages').insert([
      {
        conversation_id: conversationId,
        user_id: userId,
        role: 'user',
        content: text,
        metadata: metadata || null,
      },
    ]);
  } catch {}
}

export async function logUsageEvent(userId: string, conversationId: string | null, model: string, usage: any): Promise<void> {
  if (!supabaseService) return;
  try {
    const u: any = usage || {};
    const promptTokens = typeof u.promptTokens === 'number' ? u.promptTokens : (typeof u.inputTokens === 'number' ? u.inputTokens : 0);
    const completionTokens = typeof u.completionTokens === 'number' ? u.completionTokens : (typeof u.outputTokens === 'number' ? u.outputTokens : 0);
    const totalTokens = typeof u.totalTokens === 'number' ? u.totalTokens : (promptTokens + completionTokens);
    // Attempt to read cached input tokens from various possible fields
    let cachedPromptTokens = 0;
    try {
      const candidates: any[] = [
        u.cachedPromptTokens,
        u.cachedInputTokens,
        u.cached_input_tokens,
        u.cacheReadInputTokens,
        u.promptTokensCached,
        u.inputCachedTokens,
        u.inputTokensCached,
        u.cache_read_input_tokens,
      ];
      if (u?.inputTokenDetails && typeof u.inputTokenDetails.cached === 'number') {
        candidates.push(u.inputTokenDetails.cached);
      }
      if (u?.tokenDetails && typeof u.tokenDetails.cacheReadInputTokens === 'number') {
        candidates.push(u.tokenDetails.cacheReadInputTokens);
      }
      for (const c of candidates) {
        const n = Number(c);
        if (!isNaN(n) && n > cachedPromptTokens) cachedPromptTokens = n;
      }
      if (!isFinite(cachedPromptTokens) || cachedPromptTokens < 0) cachedPromptTokens = 0;
    } catch {
      cachedPromptTokens = 0;
    }
    const costUsd = estimateCostUsd(model, promptTokens, completionTokens, cachedPromptTokens);
    await supabaseService.from('usage_events').insert([
      {
        user_id: userId,
        conversation_id: conversationId,
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cost_usd: costUsd,
        raw: usage ?? null,
      },
    ]);
  } catch {}
}

export function hasSupabase(): boolean {
  return !!supabaseAnon && !!supabaseService;
}

export async function getProfile(userId: string): Promise<{ plan: string; daily_limit: number; daily_used: number } | null> {
  if (!supabaseService) return null;
  try {
    const { data, error } = await supabaseService
      .from('profiles')
      .select('plan, monthly_token_limit')
      .eq('user_id', userId)
      .single();
    if (error || !data) return null;
    return {
      plan: String((data as any)?.plan || 'Free'),
      daily_limit: 25,
      daily_used: 0,
    };
  } catch {
    return null;
  }
}

export async function getMonthlyUsageTokens(userId: string, monthStart?: Date): Promise<number> {
  if (!supabaseService) return 0;
  try {
    const start = monthStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const { data, error } = await supabaseService
      .from('usage_events')
      .select('total_tokens, created_at')
      .eq('user_id', userId)
      .gte('created_at', start.toISOString());
    if (error || !data) return 0;
    return (data as any[]).reduce((sum, r) => sum + (Number(r.total_tokens) || 0), 0);
  } catch {
    return 0;
  }
}

export async function getMonthlyUsageCredits(userId: string, monthStart?: Date): Promise<number> {
  if (!supabaseService) return 0;
  try {
    const start = monthStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const { data, error } = await supabaseService
      .from('usage_events')
      .select('model, prompt_tokens, completion_tokens, input_tokens, output_tokens, cost_usd, raw, created_at')
      .eq('user_id', userId)
      .gte('created_at', start.toISOString());
    if (error || !data) return 0;
    // Avoid per-event rounding: sum USD first, then convert once
    let totalUsd = 0;
    for (const r of data as any[]) {
      const model = String(r.model || '');
      // Prefer new columns, fallback to legacy input/output token columns
      const pt = (Number(r.prompt_tokens) || 0) || (Number(r.input_tokens) || 0);
      const ct = (Number(r.completion_tokens) || 0) || (Number(r.output_tokens) || 0);
      // Try to detect cached input tokens from raw payload if present
      let cachedPt = 0;
      try {
        const raw = r.raw;
        const cands: any[] = [];
        if (raw && typeof raw === 'object') {
          const td = (raw as any).tokenDetails || (raw as any).token_details || {};
          const it = (raw as any).inputTokenDetails || (raw as any).input_token_details || {};
          cands.push((raw as any).cachedPromptTokens);
          cands.push((raw as any).cacheReadInputTokens);
          cands.push((raw as any).promptTokensCached);
          cands.push((raw as any).inputCachedTokens);
          cands.push((raw as any).inputTokensCached);
          cands.push((raw as any).cache_read_input_tokens);
          if (typeof it.cached === 'number') cands.push(it.cached);
          if (typeof td.cacheReadInputTokens === 'number') cands.push(td.cacheReadInputTokens);
        }
        for (const c of cands) {
          const n = Number(c);
          if (!isNaN(n) && n > cachedPt) cachedPt = n;
        }
        if (!isFinite(cachedPt) || cachedPt < 0) cachedPt = 0;
      } catch { cachedPt = 0; }
      const usd = typeof r.cost_usd === 'number' ? r.cost_usd : estimateCostUsd(model, pt, ct, cachedPt);
      if (typeof usd === 'number' && isFinite(usd) && usd > 0) totalUsd += usd;
    }
    const credits = totalUsd * creditsPerUsd();
    // Ceil so even small usage (> $0) is reflected as at least 1 credit
    return Math.max(0, Math.ceil(credits));
  } catch {
    return 0;
  }
}

// Memory outbox helpers -------------------------------------------------
export async function addMemoryOutbox(
  userId: string,
  payload: any,
  threadId?: string | null,
  last_error?: string | null,
): Promise<void> {
  if (!supabaseService) return;
  try {
    await supabaseService
      .from('memory_outbox')
      .insert([{ user_id: userId, items: payload, thread_id: threadId || null, last_error: last_error || null }]);
  } catch {}
}

export async function listPendingMemoryOutbox(limit = 50): Promise<any[]> {
  if (!supabaseService) return [];
  try {
    const { data, error } = await supabaseService
      .from('memory_outbox')
      .select('id, user_id, thread_id, items, attempts, status, last_error, created_at, updated_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as any[];
  } catch {
    return [];
  }
}

export async function markMemoryOutbox(id: string, status: 'pending' | 'delivered' | 'failed', last_error?: string): Promise<void> {
  if (!supabaseService) return;
  try {
    // Increment attempts on non-delivered updates
    let attempts = 0;
    try {
      const { data } = await supabaseService
        .from('memory_outbox')
        .select('attempts')
        .eq('id', id)
        .single();
      attempts = Number((data as any)?.attempts ?? 0) + (status === 'delivered' ? 0 : 1);
    } catch {}
    const values: any = {
      status,
      updated_at: new Date().toISOString(),
      attempts,
    };
    if (last_error !== undefined) values.last_error = last_error;
    await supabaseService.from('memory_outbox').update(values).eq('id', id);
  } catch {}
}

export async function checkAccess(userId: string): Promise<{ allowed: boolean; reason?: string; plan?: string; limit?: number; used?: number }> {
  // Bypass credit checking in dev mode
  if (DEV_MODE) {
    return { allowed: true, plan: 'dev', limit: -1, used: 0 };
  }

  const profile = await getProfile(userId);
  const plan = (profile?.plan || 'free').toString();
  const limitCredits = monthlyCreditLimitForPlan(plan);
  if (limitCredits >= 0) {
    const usedCredits = await getMonthlyUsageCredits(userId);
    if (usedCredits >= limitCredits) {
      return { allowed: false, reason: 'monthly_credit_limit_exceeded', plan, limit: limitCredits, used: usedCredits };
    }
    return { allowed: true, plan, limit: limitCredits, used: usedCredits };
  }
  return { allowed: true, plan, limit: -1, used: 0 };
}

export async function incrementDailyRequestCounter(_userId: string): Promise<void> {
  // No-op with current schema; implement later if daily counters are added
  return;
}

export async function finishRun(userId: string, conversationId: string, _summary: string, status: 'succeeded' | 'failed' = 'succeeded'): Promise<void> {
  if (!supabaseService) return;
  try {
    await supabaseService
      .from('conversations')
      .update({ status })
      .eq('id', conversationId)
      .eq('user_id', userId);
  } catch {}
}

export function getSupabaseService(): SupabaseClient | null {
  return supabaseService;
}

export async function setConversationTitleIfEmpty(userId: string, conversationId: string, title: string): Promise<void> {
  if (!supabaseService) return;
  const t = String(title || '').trim().slice(0, 80);
  if (!t) return;
  try {
    // Fetch current title; update only if null/empty
    const { data, error } = await supabaseService
      .from('conversations')
      .select('id, user_id, title')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();
    if (error || !data) return;
    const cur = String((data as any)?.title || '').trim();
    if (!cur) {
      await supabaseService
        .from('conversations')
        .update({ title: t })
        .eq('id', conversationId)
        .eq('user_id', userId);
    }
  } catch {}
}
