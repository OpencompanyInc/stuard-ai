'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { User } from '@supabase/supabase-js';

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
}

interface SessionData {
  id: string;
  uid: string;
  email: string | null;
  display_name: string;
  token: string | null;
  authenticated: boolean;
  timestamp: string;
  expires_at: string;
}

interface AuthResult {
  success: boolean;
  error?: string;
  sessionData?: SessionData;
}

interface AuthContextType {
  user: User | null;
  userData: UserData | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string, phone?: string, smsControlEnabled?: boolean, marketingEmails?: boolean) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  logout: () => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
  updateUserData: (updates: Partial<UserData>) => Promise<AuthResult>;
  storeSessionAuth: (sessionId: string) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  // Always call useAuth to maintain hook order
  const auth = useAuth();

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
}; 