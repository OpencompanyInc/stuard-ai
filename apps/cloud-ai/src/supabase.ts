import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { estimateCostUsd, monthlyCreditLimitForPlan, creditsPerUsd } from './pricing';
import { DEV_MODE, SYNC_ACCOUNTS_FALLBACK } from './utils/config';
import { normalizeUsage } from './utils/usage';
import { embedMany } from 'ai';
import { DEFAULT_EMBEDDER } from './utils/config';
import { buildProviderEmbeddingModel } from './utils/models';
import {
  localGetExternalAccount,
  localListExternalAccounts,
  localUpsertExternalAccount,
  localSetDefaultExternalAccount,
  localDeleteExternalAccount,
  localGetExternalAccessToken,
} from './store/local-accounts';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabaseAnon: SupabaseClient | null = null;
let supabaseService: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
  supabaseAnon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
}
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  supabaseService = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
}

export interface CreditGrant {
  id: string;
  user_id: string;
  source_type: string;
  source_ref: string;
  plan?: string | null;
  amount_usd?: number | null;
  total_credits: number;
  remaining_credits: number;
  expires_at?: string | null;
  metadata?: any;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CreditSummary {
  plan: string;
  limit: number;
  used: number;
  remaining: number;
  unlimited: boolean;
  includedCredits: number;
  includedRemaining: number;
  addonCredits: number;
  addonRemaining: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

function roundCredits(value: number): number {
  const safe = Number(value || 0);
  return Number(Math.max(0, safe).toFixed(4));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let usageEventsSupportsCreditCost: boolean | null = null;

function currentBillingPeriod(profile?: { current_period_start?: string | null; current_period_end?: string | null } | null): { start: Date; end: Date } {
  const startFromProfile = profile?.current_period_start ? new Date(profile.current_period_start) : null;
  const endFromProfile = profile?.current_period_end ? new Date(profile.current_period_end) : null;
  if (startFromProfile && endFromProfile && Number.isFinite(startFromProfile.getTime()) && Number.isFinite(endFromProfile.getTime())) {
    return { start: startFromProfile, end: endFromProfile };
  }
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

function creditLimitFromProfile(plan: string, monthlyTokenLimit?: number | null): number {
  const explicit = Number(monthlyTokenLimit || 0);
  if (explicit > 0) return explicit;
  return monthlyCreditLimitForPlan(plan);
}

function isIncludedGrant(sourceType: string): boolean {
  return ['subscription_cycle', 'legacy_plan', 'trial'].includes(String(sourceType || ''));
}

export async function setConversationTitle(userId: string, conversationId: string, title: string): Promise<void> {
  if (!supabaseService) return;
  const prefs = await getSyncPreferences(userId);
  if (!prefs.sync_conversations) return;
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

export async function enqueueMemoryJob(input: {
  userId: string;
  texts: string[];
  roles?: Array<'user' | 'assistant'>;
  threadId?: string | null;
  deviceId?: string | null;
}): Promise<void> {
  if (!supabaseService) return;
  const prefs = await getSyncPreferences(input.userId);
  if (!prefs.sync_memories) {
    console.log('[sync] sync_memories disabled — skipping cloud memory enqueue');
    return;
  }
  const texts = Array.isArray(input.texts) ? input.texts.filter((s) => typeof s === 'string' && s.trim()) : [];
  if (texts.length === 0) return;
  try {
    const embeddingModel = buildProviderEmbeddingModel(DEFAULT_EMBEDDER);
    if (!embeddingModel) throw new Error(`Failed to resolve embedding model: ${DEFAULT_EMBEDDER}`);
    const { embeddings } = await embedMany({ model: embeddingModel, values: texts });
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

export type ExternalAccount = {
  id: string;
  user_id: string;
  provider: string;
  profile_label: string;
  is_default: boolean;
  account_email?: string | null;
  scopes: string[];
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  meta?: any;
  created_at?: string | null;
  updated_at?: string | null;
};

function toMs(v?: string | null): number {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function accountRecency(acc?: ExternalAccount | null): number {
  if (!acc) return 0;
  return Math.max(toMs(acc.updated_at), toMs(acc.created_at));
}

function chooseFresherAccount(preferredOnTie: ExternalAccount, other: ExternalAccount): ExternalAccount {
  const preferredTs = accountRecency(preferredOnTie);
  const otherTs = accountRecency(other);
  return preferredTs >= otherTs ? preferredOnTie : other;
}

const _syncCache = new Map<string, { val: boolean; ts: number }>();
const SYNC_CACHE_TTL = 60_000;
const ALWAYS_SYNC_EXTERNAL_ACCOUNT_PROVIDERS = new Set(['telnyx', 'whatsapp']);

function shouldAlwaysSyncExternalAccount(provider: string): boolean {
  return ALWAYS_SYNC_EXTERNAL_ACCOUNT_PROVIDERS.has(String(provider || '').toLowerCase());
}

async function shouldSyncAccounts(userId: string): Promise<boolean> {
  const now = Date.now();
  const cached = _syncCache.get(userId);
  if (cached && (now - cached.ts) < SYNC_CACHE_TTL) return cached.val;
  try {
    const prefs = await getSyncPreferences(userId);
    const result = prefs.sync_accounts || prefs.sync_integrations;
    _syncCache.set(userId, { val: result, ts: now });
    return result;
  } catch {
    if (cached) return cached.val;
    return SYNC_ACCOUNTS_FALLBACK;
  }
}

export function invalidateSyncCache(userId: string): void {
  _syncCache.delete(userId);
}

async function shouldUseSupabaseExternalAccount(userId: string, provider: string): Promise<boolean> {
  if (shouldAlwaysSyncExternalAccount(provider)) return true;
  return shouldSyncAccounts(userId);
}

export async function migrateLocalAccountsToSupabase(userId: string): Promise<{ migrated: number; errors: number }> {
  let migrated = 0;
  let errors = 0;
  try {
    const locals = await localListExternalAccounts(userId);
    for (const acc of locals) {
      try {
        await _supabaseUpsertExternalAccount({
          userId: acc.user_id,
          provider: acc.provider,
          access_token: acc.access_token,
          scopes: acc.scopes,
          refresh_token: acc.refresh_token ?? null,
          expires_at: acc.expires_at ?? null,
          meta: acc.meta ?? null,
          profileLabel: acc.profile_label,
          accountEmail: acc.account_email ?? null,
          is_default: acc.is_default,
        });
        migrated++;
      } catch {
        errors++;
      }
    }
  } catch (e: any) {
    console.error('[supabase] migrateLocalAccountsToSupabase error:', e?.message || e);
  }
  return { migrated, errors };
}

export async function getExternalAccount(
  userId: string,
  provider: string,
  profileLabel?: string,
): Promise<ExternalAccount | null> {
  const local = await localGetExternalAccount(userId, provider, profileLabel);
  if (!(await shouldUseSupabaseExternalAccount(userId, provider))) return local;
  const hot = await _supabaseGetExternalAccount(userId, provider, profileLabel);
  if (!hot) return local;
  if (!local) return hot;
  return chooseFresherAccount(local, hot);
}

async function _supabaseGetExternalAccount(
  userId: string,
  provider: string,
  profileLabel?: string,
): Promise<ExternalAccount | null> {
  if (!supabaseService) return null;
  try {
    const cols = 'id, user_id, provider, profile_label, is_default, account_email, scopes, access_token, refresh_token, expires_at, meta, created_at, updated_at';
    if (profileLabel) {
      // Try matching by profile_label first
      const { data, error } = await supabaseService
        .from('external_accounts')
        .select(cols)
        .eq('user_id', userId)
        .eq('provider', provider)
        .eq('profile_label', profileLabel)
        .single();
      if (!error && data) return data as any;
      // Fallback: match by account_email (AI may pass email instead of label)
      const { data: byEmail } = await supabaseService
        .from('external_accounts')
        .select(cols)
        .eq('user_id', userId)
        .eq('provider', provider)
        .eq('account_email', profileLabel)
        .single();
      if (byEmail) return byEmail as any;
      return null;
    }
    const { data, error } = await supabaseService
      .from('external_accounts')
      .select(cols)
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('is_default', true)
      .single();
    if (!error && data) return data as any;
    const { data: fallback } = await supabaseService
      .from('external_accounts')
      .select(cols)
      .eq('user_id', userId)
      .eq('provider', provider)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    return (fallback as any) || null;
  } catch {
    return null;
  }
}

export async function listExternalAccounts(
  userId: string,
  provider?: string,
): Promise<ExternalAccount[]> {
  if (provider && !(await shouldUseSupabaseExternalAccount(userId, provider))) {
    return localListExternalAccounts(userId, provider);
  }
  if (!provider && !(await shouldSyncAccounts(userId))) return localListExternalAccounts(userId, provider);
  const [hot, local] = await Promise.all([
    _supabaseListExternalAccounts(userId, provider),
    localListExternalAccounts(userId, provider),
  ]);
  if (hot.length === 0) return local;
  if (local.length === 0) return hot;
  const merged = new Map<string, ExternalAccount>();
  for (const acc of hot) {
    merged.set(`${acc.provider}::${acc.profile_label}`, acc);
  }
  for (const acc of local) {
    const key = `${acc.provider}::${acc.profile_label}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, acc);
      continue;
    }
    merged.set(key, chooseFresherAccount(acc, existing));
  }
  return Array.from(merged.values()).sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return toMs(a.created_at) - toMs(b.created_at);
  });
}

async function _supabaseListExternalAccounts(
  userId: string,
  provider?: string,
): Promise<ExternalAccount[]> {
  if (!supabaseService) return [];
  try {
    const cols = 'id, user_id, provider, profile_label, is_default, account_email, scopes, access_token, refresh_token, expires_at, meta, created_at, updated_at';
    let q = supabaseService
      .from('external_accounts')
      .select(cols)
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (provider) q = q.eq('provider', provider);
    const { data, error } = await q;
    if (error || !data) return [];
    return data as any[];
  } catch {
    return [];
  }
}

export async function setDefaultExternalAccount(
  userId: string,
  provider: string,
  profileLabel: string,
): Promise<boolean> {
  const localOk = await localSetDefaultExternalAccount(userId, provider, profileLabel);
  if (await shouldUseSupabaseExternalAccount(userId, provider)) {
    if (shouldAlwaysSyncExternalAccount(provider)) {
      await _supabaseSetDefaultExternalAccount(userId, provider, profileLabel);
    } else {
      try { await _supabaseSetDefaultExternalAccount(userId, provider, profileLabel); } catch {}
    }
  }
  return localOk;
}

async function _supabaseSetDefaultExternalAccount(
  userId: string,
  provider: string,
  profileLabel: string,
): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    await supabaseService
      .from('external_accounts')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('is_default', true);
    const { error } = await supabaseService
      .from('external_accounts')
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('profile_label', profileLabel);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteExternalAccount(
  userId: string,
  provider: string,
  profileLabel: string,
): Promise<boolean> {
  const localOk = await localDeleteExternalAccount(userId, provider, profileLabel);
  if (await shouldUseSupabaseExternalAccount(userId, provider)) {
    if (shouldAlwaysSyncExternalAccount(provider)) {
      await _supabaseDeleteExternalAccount(userId, provider, profileLabel);
    } else {
      try { await _supabaseDeleteExternalAccount(userId, provider, profileLabel); } catch {}
    }
  }
  return localOk;
}

async function _supabaseDeleteExternalAccount(
  userId: string,
  provider: string,
  profileLabel: string,
): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    const { data: deleted } = await supabaseService
      .from('external_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('profile_label', profileLabel)
      .select('is_default')
      .single();
    if ((deleted as any)?.is_default) {
      const { data: next } = await supabaseService
        .from('external_accounts')
        .select('profile_label')
        .eq('user_id', userId)
        .eq('provider', provider)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      if (next) {
        await supabaseService
          .from('external_accounts')
          .update({ is_default: true, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('provider', provider)
          .eq('profile_label', (next as any).profile_label);
      }
    }
    return true;
  } catch {
    return false;
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
  profileLabel?: string;
  accountEmail?: string | null;
}): Promise<void> {
  await localUpsertExternalAccount(input);
  if (await shouldUseSupabaseExternalAccount(input.userId, input.provider)) {
    if (shouldAlwaysSyncExternalAccount(input.provider)) {
      await _supabaseUpsertExternalAccount(input);
    } else {
      try { await _supabaseUpsertExternalAccount(input); } catch {}
    }
  }
}

async function _supabaseUpsertExternalAccount(input: {
  userId: string;
  provider: string;
  access_token: string;
  scopes?: string[];
  refresh_token?: string | null;
  expires_at?: string | null;
  meta?: any;
  profileLabel?: string;
  accountEmail?: string | null;
  is_default?: boolean;
}): Promise<void> {
  if (!supabaseService) return;
  try {
    const profileLabel = input.profileLabel || 'default';
    let isDefault: boolean;
    if (typeof input.is_default === 'boolean') {
      isDefault = input.is_default;
    } else {
      const { data: existingRow } = await supabaseService
        .from('external_accounts')
        .select('is_default')
        .eq('user_id', input.userId)
        .eq('provider', input.provider)
        .eq('profile_label', profileLabel)
        .single();
      if (existingRow) {
        isDefault = !!(existingRow as any).is_default;
      } else {
        const { data: siblings } = await supabaseService
          .from('external_accounts')
          .select('profile_label')
          .eq('user_id', input.userId)
          .eq('provider', input.provider)
          .limit(1);
        isDefault = !siblings || siblings.length === 0;
      }
    }

    const values: any = {
      user_id: input.userId,
      provider: input.provider,
      profile_label: profileLabel,
      is_default: isDefault,
      account_email: input.accountEmail ?? null,
      access_token: input.access_token,
      scopes: Array.isArray(input.scopes) ? input.scopes : [],
      refresh_token: input.refresh_token ?? null,
      expires_at: input.expires_at ?? null,
      meta: input.meta ?? null,
      updated_at: new Date().toISOString(),
    };

    if (isDefault) {
      await supabaseService
        .from('external_accounts')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('user_id', input.userId)
        .eq('provider', input.provider)
        .eq('is_default', true)
        .neq('profile_label', profileLabel);
    }

    const { error } = await supabaseService
      .from('external_accounts')
      .upsert(values, { onConflict: 'user_id,provider,profile_label' });
    if (error) {
      console.error(`[supabase] upsertExternalAccount failed for ${input.provider}/${profileLabel}:`, error.message, error.details, error.hint);
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }
  } catch (e: any) {
    console.error('[supabase] upsertExternalAccount error:', e?.message || e);
    throw e;
  }
}

export async function getExternalAccessToken(
  userId: string,
  provider: string,
  profileLabel?: string,
): Promise<string | null> {
  const localToken = await localGetExternalAccessToken(userId, provider, profileLabel);
  if (localToken) return localToken;
  const acc = await getExternalAccount(userId, provider, profileLabel);
  return acc?.access_token || null;
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

export async function createConversation(
  userId: string,
  firstMessage: string,
  model: string,
  firstMessageMetadata?: MessageMetadata,
  source: 'stuard' | 'workflow' | 'skill' | 'proactive' = 'stuard',
  /** When true, bypass sync_conversations check (e.g. SMS-originated conversations must always persist). */
  forcePersist = false,
): Promise<string | null> {
  if (!supabaseService) return null;
  if (!forcePersist) {
    const prefs = await getSyncPreferences(userId);
    if (!prefs.sync_conversations) {
      console.log('[sync] sync_conversations disabled — skipping cloud conversation storage');
      return null;
    }
  }
  try {
    const { data: conv, error: convErr } = await supabaseService
      .from('conversations')
      .insert([{ user_id: userId, model, source, status: 'started' }])
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
  mode?: string;
  tier?: string;
  modelId?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedPromptTokens?: number;
    thinkingTokens?: number;
    reasoningTokens?: number;
    [key: string]: any;
  };
  contextPaths?: Array<{ path: string; name: string; isDirectory: boolean }>;
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
  metadata?: MessageMetadata,
  /** When true, bypass sync_conversations check (e.g. SMS-originated messages). */
  forcePersist = false,
): Promise<void> {
  if (!supabaseService) return;
  if (!forcePersist) {
    const prefs = await getSyncPreferences(userId);
    if (!prefs.sync_conversations) return;
  }
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
  metadata?: MessageMetadata,
  /** When true, bypass sync_conversations check (e.g. SMS-originated messages). */
  forcePersist = false,
): Promise<void> {
  if (!supabaseService) return;
  if (!forcePersist) {
    const prefs = await getSyncPreferences(userId);
    if (!prefs.sync_conversations) return;
  }
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

export async function getConversationMessages(
  userId: string,
  conversationId: string,
  limit = 20,
): Promise<Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>> {
  if (!supabaseService) return [];
  const prefs = await getSyncPreferences(userId);
  if (!prefs.sync_conversations) return [];
  try {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit || 20)));
    const { data, error } = await supabaseService
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    if (error || !Array.isArray(data)) return [];
    return [...data]
      .reverse()
      .map((row: any) => ({
        role: (['user', 'assistant', 'system', 'tool'].includes(String(row?.role))
          ? row.role
          : 'user') as 'user' | 'assistant' | 'system' | 'tool',
        content: String(row?.content || ''),
      }))
      .filter((row) => row.content.trim());
  } catch {
    return [];
  }
}

async function resolveUsageConversationId(userId: string, conversationId: string | null): Promise<string | null> {
  if (!supabaseService) return null;
  const trimmed = typeof conversationId === 'string' ? conversationId.trim() : '';
  if (!trimmed || !UUID_RE.test(trimmed)) return null;
  try {
    const { data, error } = await supabaseService
      .from('conversations')
      .select('id')
      .eq('id', trimmed)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data?.id) return null;
    return String((data as any).id);
  } catch {
    return null;
  }
}

function isMissingCreditCostColumnError(error: any): boolean {
  const message = String(error?.message || error?.details || error?.hint || '');
  return /credit_cost/i.test(message) && /(column|schema cache|does not exist|unknown|could not find)/i.test(message);
}

async function insertUsageEvent(row: {
  user_id: string;
  conversation_id: string | null;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  credit_cost: number;
  raw: any;
}): Promise<string | null> {
  if (!supabaseService) return null;
  const baseRow = {
    user_id: row.user_id,
    conversation_id: row.conversation_id,
    model: row.model,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    total_tokens: row.total_tokens,
    cost_usd: row.cost_usd,
    raw: row.raw,
  };
  const includeCreditCost = usageEventsSupportsCreditCost !== false;
  let { data, error } = await supabaseService
    .from('usage_events')
    .insert([
      includeCreditCost
        ? { ...baseRow, credit_cost: row.credit_cost }
        : baseRow,
    ])
    .select('id')
    .single();
  if (error && includeCreditCost && isMissingCreditCostColumnError(error)) {
    usageEventsSupportsCreditCost = false;
    ({ data, error } = await supabaseService
      .from('usage_events')
      .insert([baseRow])
      .select('id')
      .single());
  } else if (!error && usageEventsSupportsCreditCost === null) {
    usageEventsSupportsCreditCost = includeCreditCost;
  }
  if (error) throw error;
  return data?.id ? String((data as any).id) : null;
}

export async function logUsageEvent(userId: string, conversationId: string | null, model: string, usage: any): Promise<void> {
  if (!supabaseService) return;
  try {
    const u = normalizeUsage(usage);
    const promptTokens = u.promptTokens;
    const completionTokens = u.completionTokens;
    const totalTokens = u.totalTokens;
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
      if (u?.inputTokenDetails && typeof u.inputTokenDetails.cached === 'number') candidates.push(u.inputTokenDetails.cached);
      if (u?.tokenDetails && typeof u.tokenDetails.cacheReadInputTokens === 'number') candidates.push(u.tokenDetails.cacheReadInputTokens);
      for (const c of candidates) {
        const n = Number(c);
        if (!isNaN(n) && n > cachedPromptTokens) cachedPromptTokens = n;
      }
      if (!isFinite(cachedPromptTokens) || cachedPromptTokens < 0) cachedPromptTokens = 0;
    } catch {
      cachedPromptTokens = 0;
    }
    const explicitCostUsd = Number(u.costUsd ?? u.cost_usd);
    const costUsd = Number.isFinite(explicitCostUsd) && explicitCostUsd >= 0
      ? Number(explicitCostUsd.toFixed(8))
      : estimateCostUsd(model, promptTokens, completionTokens, cachedPromptTokens);
    const creditCost = roundCredits(costUsd * creditsPerUsd());
    const persistedConversationId = await resolveUsageConversationId(userId, conversationId);
    const usageEventId = await insertUsageEvent({
      user_id: userId,
      conversation_id: persistedConversationId,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      cost_usd: costUsd,
      credit_cost: creditCost,
      raw: u,
    });
    if (creditCost > 0 && usageEventId) {
      const sourceType = String((u as any).sourceType || (u as any).source_type || model || 'usage');
      await debitCredits(userId, {
        sourceType,
        sourceRef: `usage_event:${usageEventId}`,
        credits: creditCost,
        amountUsd: costUsd,
        metadata: { conversationId, model },
      });
    }
  } catch (error: any) {
    console.error('[supabase] logUsageEvent error:', error?.message || error, { userId, conversationId, model });
  }
}

export function hasSupabase(): boolean {
  return !!supabaseAnon && !!supabaseService;
}

function normalizePhoneLookup(phone: string): string {
  let digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits && !digits.startsWith('+')) digits = '+' + digits;
  return digits;
}

export type SmsMode = 'agent' | 'proactive';
export type SmsPreferredModel = 'fast' | 'balanced' | 'smart' | 'research';
export type SmsAgentTarget = 'desktop' | 'vm' | 'auto';

export interface SmsUserState {
  user_id: string;
  mode: SmsMode;
  preferred_model: SmsPreferredModel;
  agent_target: SmsAgentTarget;
  conversation_id: string | null;
  resume_conversation_id: string | null;
  last_reply_to_phone: string | null;
  proactive_message: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SmsQueueItem {
  id: string;
  user_id: string;
  provider: string;
  provider_message_id?: string | null;
  from_phone?: string | null;
  reply_to_phone?: string | null;
  message_text?: string | null;
  mode: SmsMode;
  preferred_model: SmsPreferredModel;
  conversation_id?: string | null;
  metadata?: any;
  status: 'pending' | 'claimed' | 'completed' | 'failed' | 'expired';
  attempts: number;
  max_attempts: number;
  claimed_at?: string | null;
  claimed_by?: string | null;
  last_attempt_at?: string | null;
  next_attempt_at?: string | null;
  error_message?: string | null;
  reply_sent_at?: string | null;
  processed_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const DEFAULT_SMS_STATE: SmsUserState = {
  user_id: '',
  mode: 'agent',
  preferred_model: 'balanced',
  agent_target: 'auto',
  conversation_id: null,
  resume_conversation_id: null,
  last_reply_to_phone: null,
  proactive_message: null,
};

function normalizeSmsMode(mode: unknown): SmsMode {
  return String(mode || '').toLowerCase() === 'proactive' ? 'proactive' : 'agent';
}

function normalizeSmsAgentTarget(target: unknown): SmsAgentTarget {
  const raw = String(target || '').toLowerCase().trim();
  if (raw === 'desktop') return 'desktop';
  if (raw === 'vm') return 'vm';
  return 'auto';
}

function normalizeSmsPreferredModel(model: unknown): SmsPreferredModel {
  const raw = String(model || '').toLowerCase().trim();
  if (raw === 'fast') return 'fast';
  if (raw === 'smart') return 'smart';
  if (raw === 'research') return 'research';
  return 'balanced';
}

// Find a user by their Telnyx-verified phone (primary or secondary)
export async function findUserIdByPhone(phone: string): Promise<string | null> {
  if (!supabaseService) return null;
  try {
    const normalizedPhone = normalizePhoneLookup(phone);
    if (!normalizedPhone) return null;
    // Search across all 5 phone slots (phone, phone2, phone3, phone4, phone5)
    const { data } = await supabaseService
      .from('external_accounts')
      .select('user_id')
      .eq('provider', 'telnyx')
      .or(`meta->>phone.eq.${normalizedPhone},meta->>phone2.eq.${normalizedPhone},meta->>phone3.eq.${normalizedPhone},meta->>phone4.eq.${normalizedPhone},meta->>phone5.eq.${normalizedPhone}`)
      .limit(1)
      .maybeSingle();
    return data?.user_id as string || null;
  } catch {
    return null;
  }
}

// Find a user by their WhatsApp waId (digits without +)
export async function findUserIdByWhatsApp(waId: string): Promise<string | null> {
  if (!supabaseService) return null;
  try {
    const normalizedWaId = String(waId || '').replace(/[^\d]/g, '');
    if (!normalizedWaId) return null;
    const { data } = await supabaseService
      .from('external_accounts')
      .select('user_id')
      .eq('provider', 'whatsapp')
      .eq('meta->>waId', normalizedWaId)
      .limit(1)
      .maybeSingle();
    if (data?.user_id) return data.user_id as string;
    // Fallback: check by formatted phone (+waId)
    const { data: d2 } = await supabaseService
      .from('external_accounts')
      .select('user_id')
      .eq('provider', 'whatsapp')
      .eq('meta->>phone', `+${normalizedWaId}`)
      .limit(1)
      .maybeSingle();
    if (d2?.user_id) return d2.user_id as string;
    return null;
  } catch {
    return null;
  }
}

export async function getSmsUserState(userId: string): Promise<SmsUserState> {
  if (!supabaseService) return { ...DEFAULT_SMS_STATE, user_id: userId };
  try {
    const { data, error } = await supabaseService
      .from('sms_user_state')
      .select('user_id, mode, preferred_model, agent_target, conversation_id, resume_conversation_id, last_reply_to_phone, proactive_message, created_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        console.error('[sms-queue] getSmsUserState failed:', {
          userId,
          code: (error as any)?.code,
          message: (error as any)?.message,
          details: (error as any)?.details,
          hint: (error as any)?.hint,
        });
      }
      return { ...DEFAULT_SMS_STATE, user_id: userId };
    }
    return {
      user_id: String((data as any).user_id || userId),
      mode: normalizeSmsMode((data as any).mode),
      preferred_model: normalizeSmsPreferredModel((data as any).preferred_model),
      agent_target: normalizeSmsAgentTarget((data as any).agent_target),
      conversation_id: ((data as any).conversation_id ? String((data as any).conversation_id) : null),
      resume_conversation_id: ((data as any).resume_conversation_id ? String((data as any).resume_conversation_id) : null),
      last_reply_to_phone: ((data as any).last_reply_to_phone ? String((data as any).last_reply_to_phone) : null),
      proactive_message: ((data as any).proactive_message ? String((data as any).proactive_message) : null),
      created_at: (data as any).created_at || null,
      updated_at: (data as any).updated_at || null,
    };
  } catch (error: any) {
    console.error('[sms-queue] getSmsUserState exception:', error?.message || error, { userId });
    return { ...DEFAULT_SMS_STATE, user_id: userId };
  }
}

export async function upsertSmsUserState(input: {
  userId: string;
  mode?: SmsMode;
  preferredModel?: SmsPreferredModel;
  agentTarget?: SmsAgentTarget;
  conversationId?: string | null;
  resumeConversationId?: string | null;
  lastReplyToPhone?: string | null;
  proactiveMessage?: string | null;
}): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    const existing = await getSmsUserState(input.userId);
    const payload = {
      user_id: input.userId,
      mode: normalizeSmsMode(input.mode ?? existing.mode),
      preferred_model: normalizeSmsPreferredModel(input.preferredModel ?? existing.preferred_model),
      agent_target: normalizeSmsAgentTarget(input.agentTarget ?? existing.agent_target),
      conversation_id: input.conversationId !== undefined ? input.conversationId : existing.conversation_id,
      resume_conversation_id: input.resumeConversationId !== undefined ? input.resumeConversationId : existing.resume_conversation_id,
      last_reply_to_phone: input.lastReplyToPhone !== undefined ? input.lastReplyToPhone : existing.last_reply_to_phone,
      proactive_message: input.proactiveMessage !== undefined ? input.proactiveMessage : existing.proactive_message,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseService
      .from('sms_user_state')
      .upsert(payload, { onConflict: 'user_id' });
    if (error) {
      console.error('[sms-queue] upsertSmsUserState failed:', {
        userId: input.userId,
        code: (error as any)?.code,
        message: (error as any)?.message,
        details: (error as any)?.details,
        hint: (error as any)?.hint,
      });
    }
    return !error;
  } catch (error: any) {
    console.error('[sms-queue] upsertSmsUserState exception:', error?.message || error, { userId: input.userId });
    return false;
  }
}

export async function enqueueSmsInboxItem(input: {
  userId: string;
  provider?: string;
  providerMessageId?: string | null;
  fromPhone?: string | null;
  replyToPhone?: string | null;
  messageText: string;
  mode?: SmsMode;
  preferredModel?: SmsPreferredModel;
  conversationId?: string | null;
  metadata?: any;
  expiresAt?: string | null;
}): Promise<SmsQueueItem | null> {
  if (!supabaseService) return null;
  try {
    const state = await getSmsUserState(input.userId);
    const row: Record<string, any> = {
      user_id: input.userId,
      provider: String(input.provider || 'telnyx'),
      provider_message_id: input.providerMessageId || null,
      from_phone: input.fromPhone ? normalizePhoneLookup(input.fromPhone) : null,
      reply_to_phone: input.replyToPhone ? normalizePhoneLookup(input.replyToPhone) : (state.last_reply_to_phone || null),
      message_text: String(input.messageText || '').trim(),
      mode: normalizeSmsMode(input.mode ?? state.mode),
      preferred_model: normalizeSmsPreferredModel(input.preferredModel ?? state.preferred_model),
      conversation_id: input.conversationId !== undefined ? input.conversationId : state.conversation_id,
      metadata: input.metadata ?? {},
    };
    if (input.expiresAt) row.expires_at = input.expiresAt;
    if (!row.message_text) return null;
    const { data, error } = await supabaseService
      .from('sms_inbox_queue')
      .insert([row])
      .select('*')
      .single();
    if (error || !data) {
      if ((error as any)?.code === '23505' && input.providerMessageId) {
        const { data: existing } = await supabaseService
          .from('sms_inbox_queue')
          .select('*')
          .eq('provider', row.provider)
          .eq('provider_message_id', input.providerMessageId)
          .maybeSingle();
        return (existing as SmsQueueItem) || null;
      }
      console.error('[sms-queue] enqueueSmsInboxItem primary insert failed:', {
        userId: input.userId,
        code: (error as any)?.code,
        message: (error as any)?.message,
        details: (error as any)?.details,
        hint: (error as any)?.hint,
        providerMessageId: input.providerMessageId || null,
      });

      const fallbackRow = {
        user_id: row.user_id,
        provider: row.provider,
        provider_message_id: row.provider_message_id,
        from_phone: row.from_phone,
        reply_to_phone: row.reply_to_phone,
        message_text: row.message_text,
      };
      const { data: fallbackData, error: fallbackError } = await supabaseService
        .from('sms_inbox_queue')
        .insert([fallbackRow])
        .select('*')
        .single();
      if (fallbackError || !fallbackData) {
        console.error('[sms-queue] enqueueSmsInboxItem fallback insert failed:', {
          userId: input.userId,
          code: (fallbackError as any)?.code,
          message: (fallbackError as any)?.message,
          details: (fallbackError as any)?.details,
          hint: (fallbackError as any)?.hint,
          providerMessageId: input.providerMessageId || null,
        });
        return null;
      }
      console.log('[sms-queue] enqueueSmsInboxItem fallback insert succeeded:', {
        userId: input.userId,
        queueId: (fallbackData as any)?.id || null,
        providerMessageId: input.providerMessageId || null,
      });
      return fallbackData as SmsQueueItem;
    }
    return data as SmsQueueItem;
  } catch (error: any) {
    console.error('[sms-queue] enqueueSmsInboxItem exception:', error?.message || error, {
      userId: input.userId,
      providerMessageId: input.providerMessageId || null,
    });
    return null;
  }
}

export async function getSmsQueueItem(queueId: string): Promise<SmsQueueItem | null> {
  if (!supabaseService) return null;
  try {
    const { data, error } = await supabaseService
      .from('sms_inbox_queue')
      .select('*')
      .eq('id', queueId)
      .maybeSingle();
    if (error || !data) return null;
    return data as SmsQueueItem;
  } catch {
    return null;
  }
}

export async function markSmsQueueReplySent(queueId: string): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    const { error } = await supabaseService
      .from('sms_inbox_queue')
      .update({ reply_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', queueId)
      .is('reply_sent_at', null);
    return !error;
  } catch {
    return false;
  }
}

export function getSupabaseAdmin(): SupabaseClient | null {
  return supabaseService;
}

export const supabaseAdmin = {
  from: (...args: Parameters<SupabaseClient['from']>) => {
    if (!supabaseService) throw new Error('Supabase service client not initialised (missing SUPABASE_URL / SUPABASE_SECRET_KEY)');
    return supabaseService.from(...args);
  },
};

export interface SyncPreferences {
  sync_accounts: boolean;
  sync_conversations: boolean;
  sync_memories: boolean;
  sync_integrations: boolean;
  timezone: string | null;
}

const defaultSyncPrefs: SyncPreferences = { sync_accounts: false, sync_conversations: false, sync_memories: false, sync_integrations: false, timezone: null };

export async function getSyncPreferences(userId: string): Promise<SyncPreferences> {
  if (!supabaseService) return defaultSyncPrefs;
  try {
    const { data, error } = await supabaseService
      .from('profiles')
      .select('sync_accounts, sync_conversations, sync_memories, sync_integrations, timezone')
      .eq('id', userId)
      .single();
    if (error || !data) return defaultSyncPrefs;
    return {
      sync_accounts: !!(data as any).sync_accounts,
      sync_conversations: !!(data as any).sync_conversations,
      sync_memories: !!(data as any).sync_memories,
      sync_integrations: !!(data as any).sync_integrations,
      timezone: (data as any).timezone || null,
    };
  } catch {
    return defaultSyncPrefs;
  }
}

export async function updateSyncPreferences(userId: string, prefs: Partial<SyncPreferences>): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    const updates: any = { updated_at: new Date().toISOString() };
    if (typeof prefs.sync_accounts === 'boolean') updates.sync_accounts = prefs.sync_accounts;
    if (typeof prefs.sync_conversations === 'boolean') updates.sync_conversations = prefs.sync_conversations;
    if (typeof prefs.sync_memories === 'boolean') updates.sync_memories = prefs.sync_memories;
    if (typeof prefs.sync_integrations === 'boolean') updates.sync_integrations = prefs.sync_integrations;
    if (prefs.timezone !== undefined) updates.timezone = prefs.timezone;
    const { error } = await supabaseService
      .from('profiles')
      .update(updates)
      .eq('id', userId);
    return !error;
  } catch {
    return false;
  }
}

export async function getProfile(userId: string): Promise<{
  plan: string;
  daily_limit: number;
  daily_used: number;
  monthly_token_limit?: number | null;
  billing_customer_id?: string | null;
  billing_subscription_id?: string | null;
  billing_product_id?: string | null;
  billing_subscription_status?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
} | null> {
  if (!supabaseService) return null;
  try {
    const { data, error } = await supabaseService
      .from('profiles')
      .select('plan, monthly_token_limit, billing_customer_id, billing_subscription_id, billing_product_id, billing_subscription_status, current_period_start, current_period_end')
      .eq('id', userId)
      .single();
    if (error || !data) return null;
    return {
      plan: String((data as any)?.plan || 'Free'),
      daily_limit: 25,
      daily_used: 0,
      monthly_token_limit: Number((data as any)?.monthly_token_limit ?? 0) || 0,
      billing_customer_id: (data as any)?.billing_customer_id || null,
      billing_subscription_id: (data as any)?.billing_subscription_id || null,
      billing_product_id: (data as any)?.billing_product_id || null,
      billing_subscription_status: (data as any)?.billing_subscription_status || null,
      current_period_start: (data as any)?.current_period_start || null,
      current_period_end: (data as any)?.current_period_end || null,
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
      .select('model, prompt_tokens, completion_tokens, total_tokens, cost_usd, raw, created_at')
      .eq('user_id', userId)
      .gte('created_at', start.toISOString());
    if (error || !data) return 0;
    let totalCredits = 0;
    for (const r of data as any[]) {
      const raw = (r as any).raw && typeof (r as any).raw === 'object' ? (r as any).raw : {};
      const normalized = normalizeUsage({
        ...raw,
        promptTokens: (r as any).prompt_tokens,
        completionTokens: (r as any).completion_tokens,
        totalTokens: (r as any).total_tokens,
      });
      const model = String((r as any).model || (raw as any).model || '');
      const pt = normalized.promptTokens;
      const ct = normalized.completionTokens;
      const cachedPt = Math.max(0, Number(normalized.cachedPromptTokens || 0));
      const explicitUsd = Number((r as any).cost_usd ?? (raw as any).costUsd ?? (raw as any).cost_usd);
      const usd = Number.isFinite(explicitUsd) && explicitUsd >= 0
        ? explicitUsd
        : estimateCostUsd(model, pt, ct, cachedPt);
      if (typeof usd === 'number' && isFinite(usd) && usd > 0) totalCredits += roundCredits(usd * creditsPerUsd());
    }
    return Math.max(0, Math.ceil(totalCredits));
  } catch {
    return 0;
  }
}

export async function getActiveCreditGrants(userId: string, asOf = new Date(), options?: { includeSpent?: boolean }): Promise<CreditGrant[]> {
  if (!supabaseService) return [];
  try {
    let query = supabaseService
      .from('credit_grants')
      .select('id, user_id, source_type, source_ref, plan, amount_usd, total_credits, remaining_credits, expires_at, metadata, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (!options?.includeSpent) query = query.gt('remaining_credits', 0);
    const { data, error } = await query;
    if (error || !data) return [];
    return (data as any[])
      .filter((grant) => {
        const expiresAt = grant.expires_at ? Date.parse(grant.expires_at) : 0;
        return !expiresAt || expiresAt > asOf.getTime();
      })
      .sort((a, b) => {
        const aExpiry = a.expires_at ? Date.parse(a.expires_at) : Number.MAX_SAFE_INTEGER;
        const bExpiry = b.expires_at ? Date.parse(b.expires_at) : Number.MAX_SAFE_INTEGER;
        if (aExpiry !== bExpiry) return aExpiry - bExpiry;
        return Date.parse(a.created_at || '') - Date.parse(b.created_at || '');
      }) as CreditGrant[];
  } catch {
    return [];
  }
}

export async function upsertCreditGrant(input: {
  userId: string;
  sourceType: string;
  sourceRef: string;
  plan?: string | null;
  amountUsd?: number | null;
  totalCredits: number;
  expiresAt?: string | null;
  metadata?: any;
}): Promise<CreditGrant | null> {
  if (!supabaseService) return null;
  const totalCredits = roundCredits(input.totalCredits);
  if (totalCredits <= 0) return null;
  try {
    const { data: existing } = await supabaseService
      .from('credit_grants')
      .select('id, total_credits, remaining_credits')
      .eq('user_id', input.userId)
      .eq('source_type', input.sourceType)
      .eq('source_ref', input.sourceRef)
      .maybeSingle();
    let grant: CreditGrant | null = null;
    if (existing?.id) {
      const consumed = roundCredits((Number((existing as any).total_credits) || 0) - (Number((existing as any).remaining_credits) || 0));
      const remainingCredits = roundCredits(Math.max(0, totalCredits - consumed));
      const { data } = await supabaseService
        .from('credit_grants')
        .update({
          plan: input.plan || null,
          amount_usd: input.amountUsd ?? null,
          total_credits: totalCredits,
          remaining_credits: remainingCredits,
          expires_at: input.expiresAt ?? null,
          metadata: input.metadata || {},
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('id, user_id, source_type, source_ref, plan, amount_usd, total_credits, remaining_credits, expires_at, metadata, created_at, updated_at')
        .single();
      grant = (data as any) || null;
    } else {
      const { data } = await supabaseService
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
        .select('id, user_id, source_type, source_ref, plan, amount_usd, total_credits, remaining_credits, expires_at, metadata, created_at, updated_at')
        .single();
      grant = (data as any) || null;
    }
    if (grant?.id) {
      await supabaseService
        .from('credit_transactions')
        .upsert({
          user_id: input.userId,
          grant_id: grant.id,
          entry_type: 'grant',
          source_type: input.sourceType,
          source_ref: input.sourceRef,
          credits: totalCredits,
          amount_usd: input.amountUsd ?? null,
          metadata: input.metadata || {},
        }, { onConflict: 'user_id,grant_id,entry_type,source_type,source_ref' });
    }
    return grant;
  } catch (e: any) {
    console.error('[supabase] upsertCreditGrant error:', e?.message || e);
    return null;
  }
}

export async function ensureLegacyPlanGrant(userId: string, profile?: Awaited<ReturnType<typeof getProfile>> | null): Promise<void> {
  const resolvedProfile = profile || await getProfile(userId);
  const plan = String(resolvedProfile?.plan || 'free');
  const limitCredits = creditLimitFromProfile(plan, resolvedProfile?.monthly_token_limit ?? null);
  if (limitCredits <= 0) return;
  const period = currentBillingPeriod(resolvedProfile || null);
  await upsertCreditGrant({
    userId,
    sourceType: 'legacy_plan',
    sourceRef: `${plan}:${period.start.toISOString().slice(0, 7)}`,
    plan,
    totalCredits: limitCredits,
    expiresAt: period.end.toISOString(),
    metadata: {
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      billingSubscriptionId: resolvedProfile?.billing_subscription_id || null,
    },
  });
}

export async function debitCredits(userId: string, input: {
  sourceType: string;
  sourceRef: string;
  credits: number;
  amountUsd?: number | null;
  metadata?: any;
}): Promise<{ allocatedCredits: number; unallocatedCredits: number }> {
  if (!supabaseService) return { allocatedCredits: 0, unallocatedCredits: roundCredits(input.credits) };
  const targetCredits = roundCredits(input.credits);
  if (targetCredits <= 0) return { allocatedCredits: 0, unallocatedCredits: 0 };
  let grants = await getActiveCreditGrants(userId);
  if (grants.length === 0) {
    const profile = await getProfile(userId);
    const limitCredits = creditLimitFromProfile(String(profile?.plan || 'free'), profile?.monthly_token_limit ?? null);
    if (limitCredits > 0) {
      await ensureLegacyPlanGrant(userId, profile);
      grants = await getActiveCreditGrants(userId);
    }
  }
  let remainingToAllocate = targetCredits;
  for (const grant of grants) {
    if (remainingToAllocate <= 0) break;
    const available = roundCredits(Number(grant.remaining_credits) || 0);
    if (available <= 0) continue;
    const appliedCredits = roundCredits(Math.min(available, remainingToAllocate));
    if (appliedCredits <= 0) continue;
    await supabaseService
      .from('credit_grants')
      .update({
        remaining_credits: roundCredits(available - appliedCredits),
        updated_at: new Date().toISOString(),
      })
      .eq('id', grant.id);
    await supabaseService
      .from('credit_transactions')
      .upsert({
        user_id: userId,
        grant_id: grant.id,
        entry_type: 'debit',
        source_type: input.sourceType,
        source_ref: input.sourceRef,
        credits: appliedCredits,
        amount_usd: input.amountUsd ?? null,
        metadata: {
          ...(input.metadata || {}),
          grantSourceType: grant.source_type,
          grantSourceRef: grant.source_ref,
        },
      }, { onConflict: 'user_id,grant_id,entry_type,source_type,source_ref' });
    remainingToAllocate = roundCredits(remainingToAllocate - appliedCredits);
  }
  return {
    allocatedCredits: roundCredits(targetCredits - remainingToAllocate),
    unallocatedCredits: remainingToAllocate,
  };
}

export async function getCurrentPeriodDebitedCredits(userId: string, monthStart?: Date): Promise<number> {
  if (!supabaseService) return 0;
  try {
    const start = (monthStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1)).toISOString();
    const { data, error } = await supabaseService
      .from('credit_transactions')
      .select('credits')
      .eq('user_id', userId)
      .eq('entry_type', 'debit')
      .gte('created_at', start);
    if (error || !data) return 0;
    return Math.max(0, Math.ceil((data as any[]).reduce((sum, row) => sum + (Number(row.credits) || 0), 0)));
  } catch {
    return 0;
  }
}

export async function getCreditSummary(userId: string): Promise<CreditSummary> {
  const profile = await getProfile(userId);
  const plan = String(profile?.plan || 'free');
  const fallbackLimit = creditLimitFromProfile(plan, profile?.monthly_token_limit ?? null);
  const unlimited = fallbackLimit < 0;
  const period = currentBillingPeriod(profile || null);
  let grants = unlimited ? [] : await getActiveCreditGrants(userId, new Date(), { includeSpent: true });
  if (!unlimited && fallbackLimit > 0 && !grants.some((grant) => isIncludedGrant(grant.source_type))) {
    await ensureLegacyPlanGrant(userId, profile);
    grants = await getActiveCreditGrants(userId, new Date(), { includeSpent: true });
  }
  let includedCredits = 0;
  let includedRemaining = 0;
  let addonCredits = 0;
  let addonRemaining = 0;
  for (const grant of grants) {
    if (isIncludedGrant(grant.source_type)) {
      includedCredits += Number(grant.total_credits) || 0;
      includedRemaining += Number(grant.remaining_credits) || 0;
    } else {
      addonCredits += Number(grant.total_credits) || 0;
      addonRemaining += Number(grant.remaining_credits) || 0;
    }
  }
  const fallbackUsed = await getMonthlyUsageCredits(userId, period.start);
  const debitedCredits = await getCurrentPeriodDebitedCredits(userId, period.start);
  const used = Math.max(fallbackUsed, debitedCredits);
  const grantedCredits = includedCredits + addonCredits;
  const remainingCredits = includedRemaining + addonRemaining;
  const fallbackRemaining = unlimited ? -1 : Math.max(0, Math.floor(fallbackLimit - fallbackUsed));
  const remaining = unlimited
    ? -1
    : Math.max(0, Math.floor(grantedCredits > 0 ? remainingCredits : fallbackRemaining));
  const limit = unlimited
    ? -1
    : Math.max(0, Math.floor(grantedCredits > 0 ? grantedCredits : fallbackLimit));
  return {
    plan,
    limit,
    used,
    remaining,
    unlimited,
    includedCredits: Math.max(0, Math.floor(includedCredits || Math.max(0, fallbackLimit))),
    includedRemaining: Math.max(0, Math.floor(includedRemaining || Math.max(0, fallbackRemaining))),
    addonCredits: Math.max(0, Math.floor(addonCredits)),
    addonRemaining: Math.max(0, Math.floor(addonRemaining)),
    currentPeriodStart: period.start.toISOString(),
    currentPeriodEnd: period.end.toISOString(),
  };
}

export async function addMemoryOutbox(
  userId: string,
  payload: any,
  threadId?: string | null,
  last_error?: string | null,
): Promise<void> {
  if (!supabaseService) return;
  const prefs = await getSyncPreferences(userId);
  if (!prefs.sync_memories) return;
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
  if (DEV_MODE) {
    return { allowed: true, plan: 'dev', limit: -1, used: 0 };
  }
  const summary = await getCreditSummary(userId);
  if (!summary.unlimited && summary.remaining <= 0) {
    return { allowed: false, reason: 'monthly_credit_limit_exceeded', plan: summary.plan, limit: summary.limit, used: summary.used };
  }
  return { allowed: true, plan: summary.plan, limit: summary.limit, used: summary.used };
}

export async function incrementDailyRequestCounter(_userId: string): Promise<void> {
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

// ── Cloud Engine DB Helpers ──────────────────────────────────────────────────

export interface CloudEngine {
  id: string;
  user_id: string;
  instance_name: string;
  zone: string;
  machine_type: string;
  disk_size_gb: number;
  status: string;
  created_at: string;
  started_at: string | null;
  stopped_at: string | null;
  deleted_at: string | null;
  last_heartbeat_at: string | null;
  health_status: string | null;
  external_ip: string | null;
  agent_version: string | null;
  vm_secret: string | null;
}

export interface StorageUsage {
  id: string;
  user_id: string;
  hot_storage_gb: number;
  cold_storage_bytes: number;
  backup_object_name: string | null;
  last_sync_at: string | null;
  storage_plan_id: string;
  storage_quota_gb: number;
  cold_quota_gb: number;
  plan_purchased_at: string | null;
  plan_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

const CLOUD_ENGINE_COLS = 'id, user_id, instance_name, zone, machine_type, disk_size_gb, status, created_at, started_at, stopped_at, deleted_at, last_heartbeat_at, health_status, external_ip, agent_version, vm_secret';
const STORAGE_USAGE_COLS = 'id, user_id, hot_storage_gb, cold_storage_bytes, backup_object_name, last_sync_at, storage_plan_id, storage_quota_gb, cold_quota_gb, plan_purchased_at, plan_expires_at, created_at, updated_at';

export async function getCloudEngine(userId: string): Promise<CloudEngine | null> {
  if (!supabaseService) return null;
  try {
    const { data, error } = await supabaseService
      .from('cloud_engines')
      .select(CLOUD_ENGINE_COLS)
      .eq('user_id', userId)
      .neq('status', 'deleted')
      .single();
    if (error || !data) return null;
    return data as any;
  } catch {
    return null;
  }
}

export async function upsertCloudEngine(userId: string, values: Partial<CloudEngine>): Promise<CloudEngine | null> {
  if (!supabaseService) return null;
  try {
    const row = { user_id: userId, ...values };
    const { data, error } = await supabaseService
      .from('cloud_engines')
      .upsert(row, { onConflict: 'user_id' })
      .select(CLOUD_ENGINE_COLS)
      .single();
    if (error) {
      console.error('[supabase] upsertCloudEngine error:', error.message);
      return null;
    }
    return data as any;
  } catch {
    return null;
  }
}

export async function updateCloudEngineStatus(
  userId: string,
  status: string,
  expectedStatus?: string,
  timestamps?: { started_at?: string; stopped_at?: string; deleted_at?: string; health_status?: 'healthy' | 'unhealthy' | 'unreachable' | 'unknown' },
): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    const updates: any = { status, ...timestamps };
    let query = supabaseService
      .from('cloud_engines')
      .update(updates)
      .eq('user_id', userId);
    if (expectedStatus) {
      query = query.eq('status', expectedStatus);
    }
    const { error, count } = await query;
    if (error) {
      console.error('[supabase] updateCloudEngineStatus error:', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function deleteCloudEngine(userId: string): Promise<void> {
  if (!supabaseService) return;
  try {
    await supabaseService
      .from('cloud_engines')
      .update({ status: 'deleted', deleted_at: new Date().toISOString() })
      .eq('user_id', userId);
  } catch {}
}

export async function getStorageUsage(userId: string): Promise<StorageUsage | null> {
  if (!supabaseService) {
    console.warn('[supabase] getStorageUsage: supabaseService not initialized');
    return null;
  }
  try {
    const { data, error } = await supabaseService
      .from('storage_usage')
      .select(STORAGE_USAGE_COLS)
      .eq('user_id', userId)
      .single();
    if (error) {
      // PGRST116 = no rows found - this is normal for new users
      if (error.code !== 'PGRST116') {
        console.error('[supabase] getStorageUsage error:', error.message, error.code);
      }
      return null;
    }
    return data as any;
  } catch (e: any) {
    console.error('[supabase] getStorageUsage exception:', e?.message);
    return null;
  }
}

export async function upsertStorageUsage(userId: string, values: Partial<StorageUsage>): Promise<boolean> {
  if (!supabaseService) {
    console.warn('[supabase] upsertStorageUsage: supabaseService not initialized');
    return false;
  }
  try {
    const row = {
      user_id: userId,
      updated_at: new Date().toISOString(),
      ...values,
    };
    const { error } = await supabaseService
      .from('storage_usage')
      .upsert(row, { onConflict: 'user_id' });
    if (error) {
      console.error('[supabase] upsertStorageUsage error:', error.message, error.code, error.details);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error('[supabase] upsertStorageUsage exception:', e?.message);
    return false;
  }
}

export async function insertBillingEvent(
  userId: string,
  eventType: 'compute' | 'hot_storage' | 'cold_storage' | 'storage_purchase',
  creditsDeducted: number,
  details: any,
  billingHour?: Date,
): Promise<void> {
  if (!supabaseService) return;
  try {
    const billingHourStr = (billingHour || new Date()).toISOString();

    // Use INSERT (not upsert) so we can detect whether the row already existed.
    // If the unique constraint (user_id, event_type, billing_hour) fires, the
    // billing event was already recorded and credits were already debited — skip.
    const { error } = await supabaseService
      .from('compute_billing_events')
      .insert({
        user_id: userId,
        event_type: eventType,
        credits_deducted: creditsDeducted,
        details,
        billing_hour: billingHourStr,
      });

    if (error) {
      // 23505 = unique_violation — this hour was already billed, nothing to do
      if (error.code === '23505') return;
      console.error('[supabase] insertBillingEvent error:', error.message);
      return;
    }

    // Only debit credits when we successfully inserted a NEW billing event
    if (creditsDeducted > 0) {
      const amountUsd = Number(details?.hourlyUsd ?? details?.hourly_usd ?? details?.monthly_usd ?? 0) || null;
      await debitCredits(userId, {
        sourceType: `billing_${eventType}`,
        sourceRef: eventType === 'storage_purchase'
          ? `${eventType}:${details?.plan_id || 'plan'}:${billingHourStr}`
          : `${eventType}:${billingHourStr}`,
        credits: creditsDeducted,
        amountUsd,
        metadata: details,
      });
    }
  } catch {}
}

export async function insertStoragePurchase(
  userId: string,
  planId: string,
  previousPlanId: string | null,
  creditsCharged: number,
  action: 'purchase' | 'upgrade' | 'downgrade',
): Promise<void> {
  if (!supabaseService) return;
  try {
    const { error } = await supabaseService
      .from('storage_purchases')
      .insert({
        user_id: userId,
        plan_id: planId,
        previous_plan_id: previousPlanId,
        credits_charged: creditsCharged,
        action,
      });
    if (error) {
      console.error('[supabase] insertStoragePurchase error:', error.message);
    }
  } catch {}
}

export async function getActiveCloudEngines(): Promise<CloudEngine[]> {
  if (!supabaseService) return [];
  try {
    const { data, error } = await supabaseService
      .from('cloud_engines')
      .select(CLOUD_ENGINE_COLS)
      .neq('status', 'deleted');
    if (error || !data) return [];
    return data as any[];
  } catch {
    return [];
  }
}

// ── Cloud Engine V2: Snapshots ───────────────────────────────────────────────

export interface VMSnapshot {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: string;
  size_bytes: number;
  gcs_object_name: string | null;
  created_at: string;
  completed_at: string | null;
  deleted_at: string | null;
}

const SNAPSHOT_COLS = 'id, user_id, name, description, status, size_bytes, gcs_object_name, created_at, completed_at, deleted_at';

export async function createSnapshot(userId: string, name: string, description?: string): Promise<VMSnapshot | null> {
  if (!supabaseService) return null;
  try {
    const { data, error } = await supabaseService
      .from('vm_snapshots')
      .insert({ user_id: userId, name, description: description || null, status: 'creating' })
      .select(SNAPSHOT_COLS)
      .single();
    if (error || !data) return null;
    return data as any;
  } catch { return null; }
}

export async function getSnapshots(userId: string): Promise<VMSnapshot[]> {
  if (!supabaseService) return [];
  try {
    const { data, error } = await supabaseService
      .from('vm_snapshots')
      .select(SNAPSHOT_COLS)
      .eq('user_id', userId)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as any[];
  } catch { return []; }
}

export async function getSnapshot(userId: string, snapshotId: string): Promise<VMSnapshot | null> {
  if (!supabaseService) return null;
  try {
    const { data, error } = await supabaseService
      .from('vm_snapshots')
      .select(SNAPSHOT_COLS)
      .eq('id', snapshotId)
      .eq('user_id', userId)
      .single();
    if (error || !data) return null;
    return data as any;
  } catch { return null; }
}

export async function updateSnapshotStatus(
  snapshotId: string,
  status: string,
  extra?: { size_bytes?: number; gcs_object_name?: string; completed_at?: string; deleted_at?: string },
): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    const updates: any = { status, ...extra };
    const { error } = await supabaseService
      .from('vm_snapshots')
      .update(updates)
      .eq('id', snapshotId);
    return !error;
  } catch { return false; }
}

export async function deleteSnapshot(snapshotId: string): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    const { error } = await supabaseService
      .from('vm_snapshots')
      .update({ status: 'deleted', deleted_at: new Date().toISOString() })
      .eq('id', snapshotId);
    return !error;
  } catch { return false; }
}

// ── Cloud Engine V2: Metrics History ─────────────────────────────────────────

export interface VMMetrics {
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
}

export async function insertMetrics(userId: string, metrics: VMMetrics): Promise<void> {
  if (!supabaseService) return;
  try {
    await supabaseService
      .from('vm_metrics_history')
      .insert({ user_id: userId, ...metrics });
  } catch {}
}

export async function insertMetricsBatch(rows: Array<{ user_id: string } & VMMetrics>): Promise<void> {
  if (!supabaseService || rows.length === 0) return;
  try {
    await supabaseService.from('vm_metrics_history').insert(rows);
  } catch {}
}

export async function getMetricsHistory(userId: string, hours = 24): Promise<Array<VMMetrics & { sampled_at: string }>> {
  if (!supabaseService) return [];
  try {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data, error } = await supabaseService
      .from('vm_metrics_history')
      .select('cpu_percent, memory_percent, memory_used_mb, memory_total_mb, disk_percent, disk_used_gb, disk_total_gb, network_rx_bytes, network_tx_bytes, sampled_at')
      .eq('user_id', userId)
      .gte('sampled_at', since)
      .order('sampled_at', { ascending: true });
    if (error || !data) return [];
    return data as any[];
  } catch { return []; }
}

// ── Cloud Engine V2: Terminal Sessions ───────────────────────────────────────

export interface TerminalSession {
  id: string;
  user_id: string;
  session_name: string;
  status: string;
  cols: number;
  rows: number;
  created_at: string;
  closed_at: string | null;
}

export async function createTerminalSession(userId: string, name?: string, cols = 80, rows = 24): Promise<TerminalSession | null> {
  if (!supabaseService) return null;
  try {
    const { data, error } = await supabaseService
      .from('terminal_sessions')
      .insert({ user_id: userId, session_name: name || 'default', cols, rows })
      .select('*')
      .single();
    if (error || !data) return null;
    return data as any;
  } catch { return null; }
}

export async function closeTerminalSession(sessionId: string): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    const { error } = await supabaseService
      .from('terminal_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', sessionId);
    return !error;
  } catch { return false; }
}

export async function getActiveTerminalSessions(userId: string): Promise<TerminalSession[]> {
  if (!supabaseService) return [];
  try {
    const { data, error } = await supabaseService
      .from('terminal_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as any[];
  } catch { return []; }
}

// ── Cloud Engine V2: Health & Aggregates ─────────────────────────────────────

export async function updateEngineHealth(
  userId: string,
  health: { last_heartbeat_at?: string; health_status?: string; external_ip?: string; agent_version?: string },
): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    const { error } = await supabaseService
      .from('cloud_engines')
      .update(health)
      .eq('user_id', userId);
    return !error;
  } catch { return false; }
}

export async function getCloudEngineSummary(): Promise<{
  total: number; running: number; stopped: number; provisioning: number;
  healthy: number; unhealthy: number; unreachable: number;
}> {
  if (!supabaseService) return { total: 0, running: 0, stopped: 0, provisioning: 0, healthy: 0, unhealthy: 0, unreachable: 0 };
  try {
    const { data, error } = await supabaseService
      .from('cloud_engines')
      .select('status, health_status')
      .neq('status', 'deleted');
    if (error || !data) return { total: 0, running: 0, stopped: 0, provisioning: 0, healthy: 0, unhealthy: 0, unreachable: 0 };
    const rows = data as any[];
    return {
      total: rows.length,
      running: rows.filter(r => r.status === 'running').length,
      stopped: rows.filter(r => r.status === 'stopped').length,
      provisioning: rows.filter(r => r.status === 'provisioning' || r.status === 'starting').length,
      healthy: rows.filter(r => r.health_status === 'healthy').length,
      unhealthy: rows.filter(r => r.health_status === 'unhealthy').length,
      unreachable: rows.filter(r => r.health_status === 'unreachable').length,
    };
  } catch {
    return { total: 0, running: 0, stopped: 0, provisioning: 0, healthy: 0, unhealthy: 0, unreachable: 0 };
  }
}

export async function getTotalBilling(monthStart?: Date): Promise<{
  total_credits: number;
  compute_credits: number;
  hot_storage_credits: number;
  cold_storage_credits: number;
}> {
  if (!supabaseService) return { total_credits: 0, compute_credits: 0, hot_storage_credits: 0, cold_storage_credits: 0 };
  try {
    const since = (monthStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1)).toISOString();
    const { data, error } = await supabaseService
      .from('compute_billing_events')
      .select('event_type, credits_deducted')
      .gte('created_at', since);
    if (error || !data) return { total_credits: 0, compute_credits: 0, hot_storage_credits: 0, cold_storage_credits: 0 };
    const rows = data as any[];
    let compute = 0, hot = 0, cold = 0;
    for (const r of rows) {
      const c = Number(r.credits_deducted) || 0;
      if (r.event_type === 'compute') compute += c;
      else if (r.event_type === 'hot_storage') hot += c;
      else if (r.event_type === 'cold_storage') cold += c;
    }
    return { total_credits: compute + hot + cold, compute_credits: compute, hot_storage_credits: hot, cold_storage_credits: cold };
  } catch {
    return { total_credits: 0, compute_credits: 0, hot_storage_credits: 0, cold_storage_credits: 0 };
  }
}

export async function getAggregateMetrics(): Promise<{ avg_cpu: number; avg_memory: number; total_disk_gb: number }> {
  if (!supabaseService) return { avg_cpu: 0, avg_memory: 0, total_disk_gb: 0 };
  try {
    // Get latest metric for each active engine
    const engines = await getActiveCloudEngines();
    if (engines.length === 0) return { avg_cpu: 0, avg_memory: 0, total_disk_gb: 0 };
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // last 10 min
    const { data, error } = await supabaseService
      .from('vm_metrics_history')
      .select('user_id, cpu_percent, memory_percent, disk_total_gb, sampled_at')
      .gte('sampled_at', since)
      .order('sampled_at', { ascending: false });
    if (error || !data || data.length === 0) return { avg_cpu: 0, avg_memory: 0, total_disk_gb: 0 };
    // Deduplicate: one metric per user (latest)
    const seen = new Set<string>();
    const latest: any[] = [];
    for (const row of data as any[]) {
      if (!seen.has(row.user_id)) {
        seen.add(row.user_id);
        latest.push(row);
      }
    }
    const avgCpu = latest.reduce((s, r) => s + Number(r.cpu_percent), 0) / latest.length;
    const avgMem = latest.reduce((s, r) => s + Number(r.memory_percent), 0) / latest.length;
    const totalDisk = latest.reduce((s, r) => s + Number(r.disk_total_gb), 0);
    return { avg_cpu: Math.round(avgCpu * 100) / 100, avg_memory: Math.round(avgMem * 100) / 100, total_disk_gb: Math.round(totalDisk * 100) / 100 };
  } catch {
    return { avg_cpu: 0, avg_memory: 0, total_disk_gb: 0 };
  }
}
