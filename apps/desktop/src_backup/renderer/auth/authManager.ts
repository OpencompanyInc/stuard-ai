/**
 * Auth Manager for Desktop App
 * 
 * Handles secure token management, proactive refresh, and session validation.
 * Production-ready with proper error handling and security measures.
 */

import { supabase } from '../lib/supabaseClient';
import type { Session, User, AuthError } from '@supabase/supabase-js';

// Token refresh threshold (refresh if expiring within 5 minutes)
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

// Minimum time between refresh attempts to prevent hammering
const MIN_REFRESH_INTERVAL_MS = 30 * 1000;

// Track last refresh attempt
let lastRefreshAttempt = 0;
let refreshInProgress: Promise<Session | null> | null = null;

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  session: Session | null;
  accessToken: string | null;
  expiresAt: number | null;
  error: string | null;
}

export interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  expiresInMs: number;
  isExpired: boolean;
  isExpiringSoon: boolean;
  userId: string;
  email?: string;
}

/**
 * Get current auth state with all relevant info
 */
export async function getAuthState(): Promise<AuthState> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      return {
        isAuthenticated: false,
        user: null,
        session: null,
        accessToken: null,
        expiresAt: null,
        error: error.message,
      };
    }

    if (!session) {
      return {
        isAuthenticated: false,
        user: null,
        session: null,
        accessToken: null,
        expiresAt: null,
        error: null,
      };
    }

    const expiresAt = session.expires_at ? session.expires_at * 1000 : null;

    return {
      isAuthenticated: true,
      user: session.user,
      session,
      accessToken: session.access_token,
      expiresAt,
      error: null,
    };
  } catch (err) {
    return {
      isAuthenticated: false,
      user: null,
      session: null,
      accessToken: null,
      expiresAt: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Parse JWT token to extract expiry and other info
 * WARNING: Does not verify signature - use only for expiry checks
 */
export function parseToken(token: string): TokenInfo | null {
  if (!token || typeof token !== 'string') return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]));
    const now = Date.now();
    const expiresAt = (payload.exp || 0) * 1000;
    const expiresInMs = Math.max(0, expiresAt - now);

    return {
      accessToken: token,
      refreshToken: '', // Not available from JWT
      expiresAt,
      expiresInMs,
      isExpired: expiresAt > 0 && now >= expiresAt,
      isExpiringSoon: expiresAt > 0 && expiresInMs <= TOKEN_REFRESH_THRESHOLD_MS,
      userId: payload.sub || '',
      email: payload.email,
    };
  } catch {
    return null;
  }
}

/**
 * Check if the current session token is expired or expiring soon
 */
export async function isTokenExpiringSoon(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return true;

  const info = parseToken(session.access_token);
  return info?.isExpiringSoon ?? true;
}

/**
 * Proactively refresh the session token if needed
 * Uses deduplication to prevent multiple simultaneous refresh attempts
 */
export async function ensureFreshToken(): Promise<Session | null> {
  // Return existing refresh promise if one is in progress
  if (refreshInProgress) {
    return refreshInProgress;
  }

  // Check rate limiting
  const now = Date.now();
  if (now - lastRefreshAttempt < MIN_REFRESH_INTERVAL_MS) {
    // Get current session without refreshing
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return null;
    }

    // Check if token needs refresh
    const info = parseToken(session.access_token);
    if (info && !info.isExpired && !info.isExpiringSoon) {
      return session;
    }

    // Token needs refresh - create promise and track it
    lastRefreshAttempt = now;
    refreshInProgress = (async () => {
      try {
        console.log('[auth] Token expiring soon, refreshing...');
        const { data, error } = await supabase.auth.refreshSession();
        
        if (error) {
          console.error('[auth] Token refresh failed:', error.message);
          return session; // Return old session, let it fail naturally
        }

        if (data.session) {
          console.log('[auth] Token refreshed successfully');
          return data.session;
        }

        return session;
      } finally {
        refreshInProgress = null;
      }
    })();

    return refreshInProgress;
  } catch (err) {
    console.error('[auth] Error in ensureFreshToken:', err);
    refreshInProgress = null;
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }
}

/**
 * Get a valid access token, refreshing if necessary
 * This is the primary method to use before making API calls
 */
export async function getValidAccessToken(): Promise<string | null> {
  const session = await ensureFreshToken();
  return session?.access_token || null;
}

/**
 * Sign out and clear all auth state
 */
export async function signOut(): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Sign out failed' 
    };
  }
}

/**
 * Subscribe to auth state changes
 */
export function onAuthStateChange(
  callback: (event: string, session: Session | null) => void
): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });

  return () => {
    try {
      subscription.unsubscribe();
    } catch {}
  };
}

/**
 * Validate that a session is still valid server-side
 * Use this for sensitive operations
 */
export async function validateSession(): Promise<{ valid: boolean; user?: User; error?: string }> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error) {
      return { valid: false, error: error.message };
    }

    if (!user) {
      return { valid: false, error: 'No user found' };
    }

    return { valid: true, user };
  } catch (err) {
    return { 
      valid: false, 
      error: err instanceof Error ? err.message : 'Validation failed' 
    };
  }
}

/**
 * Set up automatic token refresh
 * Call this once on app startup
 */
export function setupAutoRefresh(): () => void {
  let intervalId: NodeJS.Timeout | null = null;

  const checkAndRefresh = async () => {
    try {
      const expiringSoon = await isTokenExpiringSoon();
      if (expiringSoon) {
        await ensureFreshToken();
      }
    } catch (err) {
      console.error('[auth] Auto-refresh check failed:', err);
    }
  };

  // Check every minute
  intervalId = setInterval(checkAndRefresh, 60000);

  // Initial check
  checkAndRefresh();

  // Return cleanup function
  return () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

// Re-export supabase for convenience
export { supabase };
