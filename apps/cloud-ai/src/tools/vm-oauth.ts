import { sendVMCommand } from '../services/vm-command';
import { getBridgeSecrets } from './bridge';
import { getResolvedBridgeSecrets, isVMExecutionTarget, execClientBridgeTool } from './device/shared';

type VmOAuthAccount = {
  provider: string;
  profile_label: string;
  is_default: boolean;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[];
  account_email: string | null;
  meta: Record<string, any>;
};

export function getOAuthToolSecrets(): Record<string, any> | undefined {
  return getBridgeSecrets() || getResolvedBridgeSecrets();
}

export function shouldUseVMOAuth(secrets: Record<string, any> | undefined = getOAuthToolSecrets()): boolean {
  return isVMExecutionTarget(secrets);
}

function normalizeVmOAuthToken(provider: string, token: any, requireAccessToken = true): VmOAuthAccount | null {
  if (requireAccessToken && !token?.accessToken) return null;
  return {
    provider: String(token.provider || provider),
    profile_label: String(token.profileLabel || 'default'),
    is_default: token.isDefault !== false,
    access_token: token.accessToken ? String(token.accessToken) : '',
    refresh_token: token.refreshToken || null,
    expires_at: token.expiresAt || null,
    scopes: Array.isArray(token.scopes) ? token.scopes.map((s: any) => String(s)) : [],
    account_email: token.accountEmail || null,
    meta: { source: 'vm', syncedAt: token.syncedAt || null },
  };
}

export async function getVMOAuthAccount(
  provider: string,
  profileLabel?: string,
  secrets: Record<string, any> | undefined = getOAuthToolSecrets(),
): Promise<VmOAuthAccount | null> {
  if (!shouldUseVMOAuth(secrets)) return null;
  const userId = String(secrets?.userId || '').trim();
  if (!userId) return null;

  const result = await sendVMCommand(userId, 'get_oauth_token', {
    provider,
    ...(profileLabel ? { profileLabel } : {}),
  }, 10_000);
  if (!result.ok) return null;
  const token = result.result?.token || result.result?.result?.token;
  return normalizeVmOAuthToken(provider, token);
}

export async function getVMOAuthAccessToken(
  provider: string,
  profileLabel?: string,
  secrets: Record<string, any> | undefined = getOAuthToolSecrets(),
): Promise<string | null> {
  const account = await getVMOAuthAccount(provider, profileLabel, secrets);
  return account?.access_token || null;
}

export async function listVMOAuthAccounts(
  provider?: string,
  secrets: Record<string, any> | undefined = getOAuthToolSecrets(),
): Promise<VmOAuthAccount[]> {
  if (!shouldUseVMOAuth(secrets)) return [];
  const userId = String(secrets?.userId || '').trim();
  if (!userId) return [];
  return listVMOAuthAccountsForUser(userId, provider);
}

/**
 * List a user's VM-stored OAuth accounts by explicit userId, bypassing the
 * bridge-secrets execution-target gate. For plain HTTP contexts (e.g. the
 * integration status endpoints) where there is no bridge/ALS context but we
 * still want the VM's authoritative view when a cloud engine is running.
 * Returns [] when the VM is unreachable (desktop-only users) — callers then
 * fall back to a device-local check.
 */
export async function listVMOAuthAccountsForUser(
  userId: string,
  provider?: string,
): Promise<VmOAuthAccount[]> {
  const id = String(userId || '').trim();
  if (!id) return [];
  const result = await sendVMCommand(id, 'oauth_list', {}, 8_000);
  if (!result.ok) return [];
  const tokens = result.result?.tokens || result.result?.result?.tokens || [];
  if (!Array.isArray(tokens)) return [];
  return tokens
    .map((token: any) => normalizeVmOAuthToken(String(token?.provider || provider || ''), token, false))
    .filter((account: VmOAuthAccount | null): account is VmOAuthAccount =>
      !!account && (!provider || account.provider.toLowerCase() === provider.toLowerCase()));
}

/**
 * Fetch a user's VM-stored OAuth account (with secrets) by explicit userId,
 * bypassing the bridge-secrets execution-target gate — for plain server
 * contexts like deploy-manager that register a VM-deployed workflow's social
 * triggers and need the VM-local token to drive the per-user provider
 * subscription. Returns null when the VM is unreachable or has no such account.
 */
export async function getVMOAuthAccountForUser(
  userId: string,
  provider: string,
  profileLabel?: string,
): Promise<VmOAuthAccount | null> {
  const id = String(userId || '').trim();
  if (!id) return null;
  const result = await sendVMCommand(id, 'get_oauth_token', {
    provider,
    ...(profileLabel ? { profileLabel } : {}),
  }, 10_000);
  if (!result.ok) return null;
  const token = result.result?.token || result.result?.result?.token;
  return normalizeVmOAuthToken(provider, token);
}

export async function storeVMOAuthAccount(
  provider: string,
  account: Partial<VmOAuthAccount> & {
    access_token?: string;
    refresh_token?: string | null;
    expires_at?: string | null;
    scopes?: string[];
    profile_label?: string;
    account_email?: string | null;
  },
  secrets: Record<string, any> | undefined = getOAuthToolSecrets(),
): Promise<boolean> {
  if (!shouldUseVMOAuth(secrets)) return false;
  const userId = String(secrets?.userId || '').trim();
  if (!userId || !account.access_token) return false;

  const result = await sendVMCommand(userId, 'store_oauth_tokens', {
    replace: false,
    tokens: [{
      provider,
      profileLabel: account.profile_label || 'default',
      isDefault: account.is_default !== false,
      accessToken: account.access_token,
      refreshToken: account.refresh_token || null,
      expiresAt: account.expires_at || null,
      scopes: Array.isArray(account.scopes) ? account.scopes : [],
      accountEmail: account.account_email || null,
    }],
  }, 10_000);
  return !!result.ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop-local OAuth — token store lives on the desktop, fetched over the
// client bridge (execLocalTool → Python agent's oauth_db handlers). The desktop
// store returns the same camelCase token shape as the VM, so
// normalizeVmOAuthToken is reused unchanged.
// ─────────────────────────────────────────────────────────────────────────────

async function getDesktopOAuthAccount(
  provider: string,
  profileLabel?: string,
): Promise<VmOAuthAccount | null> {
  try {
    const result = await execClientBridgeTool(
      'get_oauth_token',
      { provider, ...(profileLabel ? { profileLabel } : {}) },
      { silent: true },
    );
    const token = result?.token || result?.result?.token;
    if (!result?.ok || !token) return null;
    return normalizeVmOAuthToken(provider, token);
  } catch {
    return null;
  }
}

async function listDesktopOAuthAccounts(provider?: string): Promise<VmOAuthAccount[]> {
  try {
    const result = await execClientBridgeTool('oauth_list', {}, { silent: true });
    const tokens = result?.tokens || result?.result?.tokens || [];
    if (!Array.isArray(tokens)) return [];
    return tokens
      .map((token: any) => normalizeVmOAuthToken(String(token?.provider || provider || ''), token, false))
      .filter((account: VmOAuthAccount | null): account is VmOAuthAccount =>
        !!account && (!provider || account.provider.toLowerCase() === provider.toLowerCase()));
  } catch {
    return [];
  }
}

async function storeDesktopOAuthAccount(
  provider: string,
  account: Partial<VmOAuthAccount> & {
    access_token?: string;
    refresh_token?: string | null;
    expires_at?: string | null;
    scopes?: string[];
    profile_label?: string;
    account_email?: string | null;
  },
): Promise<boolean> {
  if (!account.access_token) return false;
  try {
    const result = await execClientBridgeTool('store_oauth_tokens', {
      replace: false,
      tokens: [{
        provider,
        profileLabel: account.profile_label || 'default',
        isDefault: account.is_default !== false,
        accessToken: account.access_token,
        refreshToken: account.refresh_token || null,
        expiresAt: account.expires_at || null,
        scopes: Array.isArray(account.scopes) ? account.scopes : [],
        accountEmail: account.account_email || null,
      }],
    }, { silent: true });
    return !!result?.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified client accessors — route to the VM (always-on cloud) or the desktop
// depending on the execution target. Tokens never come from Supabase.
// ─────────────────────────────────────────────────────────────────────────────

export async function getClientOAuthAccount(
  provider: string,
  profileLabel?: string,
  secrets: Record<string, any> | undefined = getOAuthToolSecrets(),
): Promise<VmOAuthAccount | null> {
  if (shouldUseVMOAuth(secrets)) return getVMOAuthAccount(provider, profileLabel, secrets);
  return getDesktopOAuthAccount(provider, profileLabel);
}

export async function getClientOAuthAccessToken(
  provider: string,
  profileLabel?: string,
  secrets: Record<string, any> | undefined = getOAuthToolSecrets(),
): Promise<string | null> {
  const account = await getClientOAuthAccount(provider, profileLabel, secrets);
  return account?.access_token || null;
}

export async function listClientOAuthAccounts(
  provider?: string,
  secrets: Record<string, any> | undefined = getOAuthToolSecrets(),
): Promise<VmOAuthAccount[]> {
  if (shouldUseVMOAuth(secrets)) return listVMOAuthAccounts(provider, secrets);
  return listDesktopOAuthAccounts(provider);
}

export async function storeClientOAuthAccount(
  provider: string,
  account: Partial<VmOAuthAccount> & {
    access_token?: string;
    refresh_token?: string | null;
    expires_at?: string | null;
    scopes?: string[];
    profile_label?: string;
    account_email?: string | null;
  },
  secrets: Record<string, any> | undefined = getOAuthToolSecrets(),
): Promise<boolean> {
  if (shouldUseVMOAuth(secrets)) return storeVMOAuthAccount(provider, account, secrets);
  return storeDesktopOAuthAccount(provider, account);
}
