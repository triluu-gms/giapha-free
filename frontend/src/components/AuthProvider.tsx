'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, AUTH_EXPIRED_EVENT } from '@/lib/api';
import { rememberTree } from '@/lib/currentTree';
import type { User } from '@/lib/types';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: User | null;
  status: Status;
  /** Starts social login/registration with the given provider (full-page redirect). */
  loginWithProvider: (provider: string, nextPath?: string) => void;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    inviteToken?: string;
    privacyVersion: string;
  }) => Promise<void>;
  /** Re-reads the signed-in user (e.g. after verifying the email in another tab). */
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// The session lives in an HttpOnly cookie that scripts can't read, so the
// signed-in state is learned by asking the API who we are.
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  const signedIn = useCallback((me: User) => {
    setUser(me);
    setStatus('authenticated');
  }, []);

  useEffect(() => {
    api
      .me()
      .then(signedIn)
      .catch(() => setStatus('anonymous'));
  }, [signedIn]);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setStatus('anonymous');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const loginWithProvider = useCallback((provider: string, nextPath = '/') => {
    window.location.href = api.loginUrl(provider, nextPath);
  }, []);

  const loginWithPassword = useCallback(
    async (email: string, password: string) => signedIn(await api.passwordLogin(email, password)),
    [signedIn],
  );

  const register = useCallback(
    async (input: { name: string; email: string; password: string; inviteToken?: string; privacyVersion: string }) => {
      const { joinedTreeId, ...me } = await api.register(input);
      // Registered from an invitation: open the tree they were invited to.
      if (joinedTreeId) rememberTree(joinedTreeId);
      signedIn(me);
    },
    [signedIn],
  );

  const refreshUser = useCallback(async () => {
    try {
      signedIn(await api.me());
    } catch {
      setUser(null);
      setStatus('anonymous');
    }
  }, [signedIn]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setStatus('anonymous');
      router.push('/login');
    }
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      loginWithProvider,
      loginWithPassword,
      register,
      refreshUser,
      logout,
    }),
    [user, status, loginWithProvider, loginWithPassword, register, refreshUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
