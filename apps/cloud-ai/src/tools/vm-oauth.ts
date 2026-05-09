import { sendVMCommand } from '../services/vm-command';
import { getBridgeSecrets } from './bridge';
import { getResolvedBridgeSecrets, isVMExecutionTarget } from './device/shared';

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

  const result = await sendVMCommand(userId, 'oauth_list', {}, 10_000);
  if (!result.ok) return [];
  const tokens = result.result?.tokens || result.result?.result?.tokens || [];
  if (!Array.isArray(tokens)) return [];
  return tokens
    .map((token: any) => normalizeVmOAuthToken(String(token?.provider || provider || ''), token, false))
    .filter((account: VmOAuthAccount | null): account is VmOAuthAccount =>
      !!account && (!provider || account.provider.toLowerCase() === provider.toLowerCase()));
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
