import { supabase } from '@/lib/supabaseClient';

const BILLING_PROXY_BASE = '/api/billing';

export async function getBillingAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function billingApiFetch<T = any>(
  path: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T | null> {
  const token = await getBillingAuthToken();
  if (!token) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 15_000);

  if (options?.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const { timeoutMs: _timeoutMs, headers, ...fetchOptions } = options || {};
    const resolvedHeaders = headers instanceof Headers
      ? Object.fromEntries(headers.entries())
      : (headers as Record<string, string> | undefined);

    const response = await fetch(`${BILLING_PROXY_BASE}${path}`, {
      ...fetchOptions,
      headers: {
        ...resolvedHeaders,
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null;

    if (!response.ok) {
      return null;
    }

    return payload?.ok === false ? null : payload;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }

    if (error instanceof TypeError) {
      throw new Error('Unable to reach billing service.');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}