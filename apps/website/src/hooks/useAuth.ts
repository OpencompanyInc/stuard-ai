'use client';

import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  DEFAULT_ONBOARDING_PROFILE,
  isOnboardingPath,
  normalizeOnboardingProfile,
  toOnboardingProfileRow,
  type OnboardingPath,
  type OnboardingProfile,
} from '@/lib/onboardingProfile';

interface UserData {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  smsControlEnabled: boolean;
  emailVerified: boolean;
  createdAt: Date;
  preferences: {
    marketingEmails: boolean;
  };
  plan?: string;
  stripeCustomerId?: string | null;
  onboardingPath?: OnboardingPath | null;
  onboardingProfile?: OnboardingProfile | null;
}

async function fetchProfile(userId: string) {
  const byUserId = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!byUserId.error && byUserId.data) return byUserId;

  return supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
}

async function upsertProfile(userId: string, row: Record<string, any>) {
  const byUserId = await supabase
    .from('profiles')
    .upsert({ user_id: userId, ...row }, { onConflict: 'user_id' });

  if (!byUserId.error) return byUserId;

  return supabase
    .from('profiles')
    .upsert({ id: userId, ...row }, { onConflict: 'id' });
}

function getOnboardingProfileFromRow(row: Record<string, any>): OnboardingProfile | null {
  const normalized = normalizeOnboardingProfile(row.onboarding_profile);
  if (normalized) return normalized;

  if (isOnboardingPath(row.onboarding_path)) {
    return {
      ...DEFAULT_ONBOARDING_PROFILE,
      path: row.onboarding_path,
      updatedAt: typeof row.onboarding_completed_at === 'string' ? row.onboarding_completed_at : undefined,
    };
  }

  return null;
}

function mapUserData(user: User, data: Record<string, any>): UserData {
  const onboardingProfile = getOnboardingProfileFromRow(data);

  return {
    uid: user.id,
    email: data.email ?? user.email,
    displayName: data.display_name ?? user.user_metadata?.fullName ?? user.email?.split('@')[0] ?? null,
    phoneNumber: data.phone_number ?? null,
    smsControlEnabled: Boolean(data.sms_control_enabled),
    emailVerified: Boolean(user.email_confirmed_at),
    createdAt: data.created_at ? new Date(data.created_at) : new Date(),
    preferences: {
      marketingEmails: Boolean(data.marketing_emails)
    },
    plan: data.plan || 'free',
    stripeCustomerId: data.stripe_customer_id,
    onboardingPath: onboardingProfile?.path ?? (isOnboardingPath(data.onboarding_path) ? data.onboarding_path : null),
    onboardingProfile,
  };
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(typeof window !== 'undefined');
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (!isClient) return;

    const initializeAuth = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!isMounted) return;
        setUser(user ?? null);

        if (user) {
          const { data, error } = await fetchProfile(user.id);
          if (!isMounted) return;
          if (!error && data) {
            setUserData(mapUserData(user, data));
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initializeAuth();

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event: string, session: { user: User | null } | null) => {
      if (!isMounted) return;
      const nextUser = session?.user ?? null;
      setUser(nextUser);

      if (nextUser) {
        const { data, error } = await fetchProfile(nextUser.id);
        if (!isMounted) return;
        if (!error && data) {
          setUserData(mapUserData(nextUser, data));
        } else {
          setUserData(null);
        }
      } else {
        setUserData(null);
      }
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [isClient]);

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    phone?: string,
    smsControlEnabled: boolean = false,
    marketingEmails: boolean = false,
    onboardingProfile?: OnboardingProfile | null
  ) => {
    if (!isClient) {
      return { error: 'Not available on server side', success: false };
    }

    try {
      const resolvedOnboardingProfile = onboardingProfile
        ? {
            ...onboardingProfile,
            source: onboardingProfile.source ?? 'website_signup',
            updatedAt: new Date().toISOString(),
          }
        : null;

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            fullName,
            phone,
            smsControlEnabled,
            marketingEmails,
            onboardingPath: resolvedOnboardingProfile?.path ?? null,
          },
          emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/verify-email` : undefined,
        },
      });

      if (error) {
        return { error: error.message, success: false };
      }

      const newUser = data.user;
      if (newUser) {
        const onboardingRow = resolvedOnboardingProfile ? toOnboardingProfileRow(resolvedOnboardingProfile) : null;
        const profile = {
          email,
          display_name: fullName,
          phone_number: phone ?? null,
          sms_control_enabled: smsControlEnabled,
          marketing_emails: marketingEmails,
          created_at: new Date().toISOString(),
          ...(onboardingRow ?? {}),
        };
        await upsertProfile(newUser.id, profile);

        setUserData({
          uid: newUser.id,
          email,
          displayName: fullName,
          phoneNumber: phone ?? null,
          smsControlEnabled,
          emailVerified: false,
          createdAt: new Date(),
          preferences: { marketingEmails },
          plan: 'free',
          onboardingPath: resolvedOnboardingProfile?.path ?? null,
          onboardingProfile: resolvedOnboardingProfile,
        });
      }

      return { user: newUser, success: true };
    } catch (error: unknown) {
      console.error('Signup error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { error: errorMessage, success: false };
    }
  };

  const signIn = async (email: string, password: string) => {
    if (!isClient) {
      return { error: 'Not available on server side', success: false };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        return { error: error.message, success: false };
      }

      return { user: data.user, success: true };
    } catch (error: unknown) {
      console.error('Signin error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { error: errorMessage, success: false };
    }
  };

  const signInWithGoogle = async () => {
    if (!isClient) {
      return { error: 'Not available on server side', success: false };
    }

    try {
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/auth` : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
        },
      });

      if (error) {
        return { error: error.message, success: false };
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('Google signin error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { error: errorMessage, success: false };
    }
  };

  const logout = async () => {
    if (!isClient) {
      return { error: 'Not available on server side', success: false };
    }

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        return { error: error.message, success: false };
      }

      setUser(null);
      setUserData(null);
      return { success: true };
    } catch (error: unknown) {
      console.error('Logout error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { error: errorMessage, success: false };
    }
  };

  const resetPassword = async (email: string) => {
    if (!isClient) {
      return { error: 'Not available on server side', success: false };
    }

    try {
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

      if (error) {
        return { error: error.message, success: false };
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('Reset password error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { error: errorMessage, success: false };
    }
  };

  const updateUserData = async (updates: Partial<UserData>) => {
    if (!isClient) {
      return { error: 'Not available on server side', success: false };
    }
    if (!user) return { error: 'No user logged in', success: false };
    try {
      const onboardingRow = updates.onboardingProfile
        ? toOnboardingProfileRow({
            ...updates.onboardingProfile,
            updatedAt: new Date().toISOString(),
          })
        : null;

      const mapped = {
        ...(updates.displayName !== undefined ? { display_name: updates.displayName } : {}),
        ...(updates.phoneNumber !== undefined ? { phone_number: updates.phoneNumber } : {}),
        ...(updates.smsControlEnabled !== undefined ? { sms_control_enabled: updates.smsControlEnabled } : {}),
        ...(updates.preferences?.marketingEmails !== undefined ? { marketing_emails: updates.preferences.marketingEmails } : {}),
        ...(onboardingRow ?? {}),
      };
      const { error } = await upsertProfile(user.id, mapped);
      if (error) return { error: error.message, success: false };
      if (userData) setUserData({ ...userData, ...updates });

      return { success: true };
    } catch (error: unknown) {
      console.error('Update user data error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { error: errorMessage, success: false };
    }
  };

  // Session-based authentication for Electron app
  const storeSessionAuth = async (sessionId: string) => {
    if (!isClient) {
      return { error: 'Not available on server side', success: false };
    }
    if (!user) {
      return { error: 'User not authenticated', success: false };
    }
    try {
      const { data: sessionDataRes } = await supabase.auth.getSession();
      const token = sessionDataRes.session?.access_token || null;
      const sessionAuthData = {
        id: sessionId,
        uid: user.id,
        email: user.email ?? null,
        display_name: (user.user_metadata?.fullName || user.email?.split('@')[0] || 'User') as string,
        token,
        authenticated: true,
        timestamp: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
      const { error } = await supabase.from('sessions').upsert(sessionAuthData, { onConflict: 'id' });
      if (error) return { error: error.message, success: false };
      return { success: true, sessionData: sessionAuthData };
    } catch (error: unknown) {
      console.error('Store session auth error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { error: errorMessage, success: false };
    }
  };

  return {
    user,
    userData,
    loading,
    signUp,
    signIn,
    signInWithGoogle,
    logout,
    resetPassword,
    updateUserData,
    storeSessionAuth
  };
};