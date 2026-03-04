import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { estimateCostUsd, monthlyCreditLimitForPlan, creditsFromUsd, creditsPerUsd } from './pricing';
import { DEV_MODE, SYNC_ACCOUNTS_FALLBACK } from './utils/config';
import { normalizeUsage } from './utils/usage';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { DEFAULT_EMBEDDER } from './utils/config';
import {
  localGetExternalAccount,
  localListExternalAccounts,
  localUpsertExternalAccount,
  localSetDefaultExternalAccount,
  localDeleteExternalAccount,
  localGetExternalAccessToken,
} from './store/local-accounts';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
// Prefer new key names, fall back to legacy
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

  // Respect sync_memories preference — skip cloud memory storage when disabled
  const prefs = await getSyncPreferences(input.userId);
  if (!prefs.sync_memories) {
    console.log('[sync] sync_memories disabled — skipping cloud memory enqueue');
    return;
  }

  const texts = Array.isArray(input.texts) ? input.texts.filter((s) => typeof s === 'string' && s.trim()) : [];
  if (texts.length === 0) return;
  try {
    const modelId = DEFAULT_EMBEDDER.replace('openai/', '');
    const { embeddings } = await embedMany({ 
      model: openai.embedding(modelId), 
      values: texts 
    });
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

/** Resolve whether integration accounts should be synced to Supabase for this user.
 *  Enabled when either sync_accounts or sync_integrations is true.
 *  Caches per-user result for 60s to avoid hitting Supabase on every operation.
 *  Falls back to SYNC_ACCOUNTS_FALLBACK env var when the DB query fails. */
const _syncCache = new Map<string, { val: boolean; ts: number }>();
const SYNC_CACHE_TTL = 60_000; // 60 seconds

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
    // When the DB query fails, use the env-var fallback and stale cache
    if (cached) return cached.val;
    return SYNC_ACCOUNTS_FALLBACK;
  }
}

/** Invalidate the sync-accounts cache for a user (e.g. after toggling sync_integrations). */
export function invalidateSyncCache(userId: string): void {
  _syncCache.delete(userId);
}

/**
 * Migrate all local encrypted accounts to Supabase.
 * Called when a user enables sync_integrations so existing local tokens carry over.
 * Idempotent — Supabase upserts by (user_id, provider, profile_label).
 */
export async function migrateLocalAccountsToSupabase(userId: string): Promise<{ migrated: number; errors: number }> {
  let migrated = 0, errors = 0;
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
          is_default: acc.is_default, // Preserve the local default flag
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

/**
 * Get a single external account. If profileLabel is provided, fetches that specific
 * profile. Otherwise returns the default profile for the provider.
 *
 * Read strategy:
 *   sync ON  → read both Supabase + local, then use the freshest record
 *              (local wins ties as source-of-truth).
 *   sync OFF → read from local only.
 */
export async function getExternalAccount(
  userId: string,
  provider: string,
  profileLabel?: string,
): Promise<ExternalAccount | null> {
  const local = await localGetExternalAccount(userId, provider, profileLabel);
  if (!(await shouldSyncAccounts(userId))) return local;

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
      const { data, error } = await supabaseService
        .from('external_accounts')
        .select(cols)
        .eq('user_id', userId)
        .eq('provider', provider)
        .eq('profile_label', profileLabel)
        .single();
      if (error || !data) return null;
      return data as any;
    }
    // Fetch default profile
    const { data, error } = await supabaseService
      .from('external_accounts')
      .select(cols)
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('is_default', true)
      .single();
    if (!error && data) return data as any;
    // Fallback: if no default flag, get oldest (original) entry
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

/**
 * List all connected profiles for a provider (or all providers if omitted).
 *
 * Read strategy:
 *   sync ON  → merge Supabase + local, preferring fresher local records on conflicts.
 *   sync OFF → read from local only.
 */
export async function listExternalAccounts(
  userId: string,
  provider?: string,
): Promise<ExternalAccount[]> {
  if (!(await shouldSyncAccounts(userId))) return localListExternalAccounts(userId, provider);
  const [hot, local] = await Promise.all([
    _supabaseListExternalAccounts(userId, provider),
    localListExternalAccounts(userId, provider),
  ]);

  if (hot.length === 0) return local;
  if (local.length === 0) return hot;

  const merged = new Map<string, ExternalAccount>();

  for (const acc of hot) {
    const key = `${acc.provider}::${acc.profile_label}`;
    merged.set(key, acc);
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

/**
 * Set a profile as the default for its provider. Clears is_default on all
 * other profiles for the same (user_id, provider).
 * Dual-write: always update local, also update Supabase when sync is on.
 */
export async function setDefaultExternalAccount(
  userId: string,
  provider: string,
  profileLabel: string,
): Promise<boolean> {
  // Always update local (cold store = source of truth)
  const localOk = await localSetDefaultExternalAccount(userId, provider, profileLabel);
  if (await shouldSyncAccounts(userId)) {
    try { await _supabaseSetDefaultExternalAccount(userId, provider, profileLabel); } catch {}
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
    // Unset current default(s)
    await supabaseService
      .from('external_accounts')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('is_default', true);
    // Set new default
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

/**
 * Delete a specific profile. If it was the default, promote the next one.
 * Dual-write: always delete from local, also delete from Supabase when sync is on.
 */
export async function deleteExternalAccount(
  userId: string,
  provider: string,
  profileLabel: string,
): Promise<boolean> {
  const localOk = await localDeleteExternalAccount(userId, provider, profileLabel);
  if (await shouldSyncAccounts(userId)) {
    try { await _supabaseDeleteExternalAccount(userId, provider, profileLabel); } catch {}
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
    // If deleted was default, promote next oldest
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

/**
 * Upsert an external account (OAuth token).
 *
 * Write strategy (dual-write):
 *   Always write to local (cold store = source of truth).
 *   When sync is on, also write to Supabase (hot store).
 *   This prevents data loss when Supabase is temporarily unreachable.
 */
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
  // Always write to local first (cold store = source of truth)
  await localUpsertExternalAccount(input);
  // Also write to Supabase when sync is enabled
  if (await shouldSyncAccounts(input.userId)) {
    try { await _supabaseUpsertExternalAccount(input); } catch {}
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
  /** When explicitly provided (e.g., during migration), use this value for is_default. */
  is_default?: boolean;
}): Promise<void> {
  if (!supabaseService) return;
  try {
    const profileLabel = input.profileLabel || 'default';

    // Determine is_default: use explicit value if provided, otherwise compute
    let isDefault: boolean;
    if (typeof input.is_default === 'boolean') {
      isDefault = input.is_default;
    } else {
      // Check if this exact profile already exists (in which case keep its current is_default)
      const { data: existingRow } = await supabaseService
        .from('external_accounts')
        .select('is_default')
        .eq('user_id', input.userId)
        .eq('provider', input.provider)
        .eq('profile_label', profileLabel)
        .single();
      if (existingRow) {
        // Updating existing row — keep its current is_default
        isDefault = !!(existingRow as any).is_default;
      } else {
        // New row — set as default only if no other profiles exist for this provider
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

    // If we're about to set is_default=true, clear any other default first
    // to avoid violating the partial unique index (idx_external_accounts_one_default)
    if (isDefault) {
      await supabaseService
        .from('external_accounts')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('user_id', input.userId)
        .eq('provider', input.provider)
        .eq('is_default', true)
        .neq('profile_label', profileLabel);
    }

    // Upsert by (user_id, provider, profile_label)
    const { error } = await supabaseService
      .from('external_accounts')
      .upsert(values, { onConflict: 'user_id,provider,profile_label' });
    if (error) {
      console.error(`[supabase] upsertExternalAccount failed for ${input.provider}/${profileLabel}:`, error.message, error.details, error.hint);
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }
  } catch (e: any) {
    console.error(`[supabase] upsertExternalAccount error:`, e?.message || e);
    throw e;
  }
}

/**
 * Get the access token for a provider. Uses the specified profile or the default.
 */
export async function getExternalAccessToken(
  userId: string,
  provider: string,
  profileLabel?: string,
): Promise<string | null> {
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

// Start a new automation run and record the user's first message
export async function createConversation(
  userId: string,
  firstMessage: string,
  model: string,
  firstMessageMetadata?: MessageMetadata,
  source: 'stuard' | 'workflow' = 'stuard'
): Promise<string | null> {
  if (!supabaseService) return null;

  // Respect sync_conversations preference — skip cloud storage when disabled
  const prefs = await getSyncPreferences(userId);
  if (!prefs.sync_conversations) {
    console.log('[sync] sync_conversations disabled — skipping cloud conversation storage');
    return null;
  }

  try {
    // Create a conversation and attach the first user message
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
  // Model selection context (persisted so history reload can display what was requested/used)
  mode?: string;
  tier?: string;
  modelId?: string;
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
    const u = normalizeUsage(usage);
    const promptTokens = u.promptTokens;
    const completionTokens = u.completionTokens;
    const totalTokens = u.totalTokens;
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
    const explicitCostUsd = Number(u.costUsd ?? u.cost_usd);
    const costUsd = Number.isFinite(explicitCostUsd) && explicitCostUsd >= 0
      ? Number(explicitCostUsd.toFixed(8))
      : estimateCostUsd(model, promptTokens, completionTokens, cachedPromptTokens);
    await supabaseService.from('usage_events').insert([
      {
        user_id: userId,
        conversation_id: conversationId,
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cost_usd: costUsd,
        raw: u,
      },
    ]);
  } catch {}
}

export function hasSupabase(): boolean {
  return !!supabaseAnon && !!supabaseService;
}

/**
 * Admin / service-role Supabase client for server-side operations
 * (deploy-manager, cloud-engine ops, etc.).
 * Returns null when Supabase credentials are not configured (local dev).
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  return supabaseService;
}

/** Alias kept for backwards-compat with deploy-manager & other services */
export const supabaseAdmin = {
  from: (...args: Parameters<SupabaseClient['from']>) => {
    if (!supabaseService) throw new Error('Supabase service client not initialised (missing SUPABASE_URL / SUPABASE_SECRET_KEY)');
    return supabaseService.from(...args);
  },
};

// ── Sync Preferences ────────────────────────────────────────────────────────

export interface SyncPreferences {
  sync_accounts: boolean;
  sync_conversations: boolean;
  sync_memories: boolean;
  sync_integrations: boolean;
  timezone: string | null;
}

const defaultSyncPrefs: SyncPreferences = { sync_accounts: false, sync_conversations: true, sync_memories: false, sync_integrations: false, timezone: null };

/** Read sync preferences from the user's profile row. */
export async function getSyncPreferences(userId: string): Promise<SyncPreferences> {
  if (!supabaseService) return defaultSyncPrefs;
  try {
    const { data, error } = await supabaseService
      .from('profiles')
      .select('sync_accounts, sync_conversations, sync_memories, sync_integrations, timezone')
      .eq('user_id', userId)
      .single();
    if (error || !data) return defaultSyncPrefs;
    return {
      sync_accounts: !!(data as any).sync_accounts,
      sync_conversations: (data as any).sync_conversations !== false, // default true
      sync_memories: !!(data as any).sync_memories,
      sync_integrations: !!(data as any).sync_integrations,
      timezone: (data as any).timezone || null,
    };
  } catch {
    return defaultSyncPrefs;
  }
}

/** Update sync preferences on the user's profile row. */
export async function updateSyncPreferences(userId: string, prefs: Partial<SyncPreferences>): Promise<boolean> {
  if (!supabaseService) return false;
  try {
    const updates: any = { updated_at: new Date().toISOString() };
    if (typeof prefs.sync_accounts === 'boolean') updates.sync_accounts = prefs.sync_accounts;
    if (typeof prefs.sync_conversations === 'boolean') updates.sync_conversations = prefs.sync_conversations;
    if (typeof prefs.sync_memories === 'boolean') updates.sync_memories = prefs.sync_memories;
    if (typeof prefs.sync_integrations === 'boolean') updates.sync_integrations = prefs.sync_integrations;
    if (prefs.timezone !== undefined) updates.timezone = prefs.timezone; // null clears override
    const { error } = await supabaseService
      .from('profiles')
      .update(updates)
      .eq('user_id', userId);
    return !error;
  } catch {
    return false;
  }
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
      const explicitUsd = Number((r as any).cost_usd);
      const usd = Number.isFinite(explicitUsd) && explicitUsd >= 0
        ? explicitUsd
        : estimateCostUsd(model, pt, ct, cachedPt);
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

  // Respect sync_memories preference
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
  timestamps?: { started_at?: string; stopped_at?: string; deleted_at?: string },
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
    const { error } = await supabaseService
      .from('compute_billing_events')
      .upsert({
        user_id: userId,
        event_type: eventType,
        credits_deducted: creditsDeducted,
        details,
        billing_hour: (billingHour || new Date()).toISOString(),
      }, { onConflict: 'user_id,event_type,billing_hour' });
    if (error) {
      console.error('[supabase] insertBillingEvent error:', error.message);
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
