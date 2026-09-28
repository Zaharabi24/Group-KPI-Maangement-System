import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, detectApiMode, isDemoMode, refreshAccessToken, setAccessToken, setSessionExpiredHandler } from '@/lib/api';
import type { AuthResponse, CurrentUser, Profile, RoleCode } from '@/lib/types';
import { ROLE_HOME, primaryRole } from '@/lib/format';

interface AuthContextValue {
  user: CurrentUser | null;
  profile: Profile | null;
  loading: boolean;
  authenticated: boolean;
  demo: boolean;
  home: string;
  role: RoleCode;
  hasPermission: (permission: string) => boolean;
  hasRole: (...roles: RoleCode[]) => boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<{ home: string; mustConfirmOrganisation: boolean }>;
  quickSignIn: (email: string, password?: string) => Promise<{ home: string; mustConfirmOrganisation: boolean }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [home, setHome] = useState<string>('/my-kpi');

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setProfile(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login?reason=expired');
      }
    });
  }, [clearSession]);

  const loadProfile = useCallback(async () => {
    try {
      const data = await api.get<Profile>('/me');
      setProfile(data);
    } catch {
      setProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  // Restore the session from the HttpOnly refresh cookie on first paint.
  // `refreshAccessToken` is single-flight, so React StrictMode's double effect
  // and multiple tabs share one rotation (see src/lib/api.ts).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Decide once whether the real API is available. On a static deployment
        // this switches the client to the in-browser demo dataset.
        const mode = await detectApiMode();
        if (cancelled) return;

        if (mode === 'demo') {
          const token = await refreshAccessToken();
          if (cancelled) return;
          const principal = await api.get<CurrentUser>('/auth/me');
          if (cancelled) return;
          setUser(principal);
          setHome(ROLE_HOME[primaryRole(principal.roles)]);
          await loadProfile();
          return;
        }

        const token = await refreshAccessToken();
        if (!token) throw new Error('no-session');
        if (cancelled) return;
        const principal = await api.get<CurrentUser>('/auth/me');
        if (cancelled) return;
        setUser(principal);
        setHome(ROLE_HOME[primaryRole(principal.roles)]);
        await loadProfile();
      } catch {
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearSession, loadProfile]);

  const login = useCallback(
    async (email: string, password: string, rememberMe = false) => {
      const result = await api.post<AuthResponse>(
        '/auth/login',
        { email, password, rememberMe },
        { headers: { 'X-Skip-Auth-Redirect': '1' } },
      );
      setAccessToken(result.accessToken);
      setHome(result.home ?? ROLE_HOME[primaryRole(result.user.roles)]);
      const principal = await api.get<CurrentUser>('/auth/me');
      setUser(principal);
      await loadProfile();
      return { home: result.home ?? ROLE_HOME[primaryRole(result.user.roles)], mustConfirmOrganisation: result.mustConfirmOrganisation === true };
    },
    [loadProfile],
  );

  /**
   * One-click sign-in.
   *
   * Used by the demo account cards. It signs in with the given address using the
   * seeded password, and falls back to opening the dashboard directly when the
   * platform is running in demo mode.
   */
  const quickSignIn = useCallback(
    async (email: string, password = 'Anwar@KPI2026') => {
      return login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* the session is cleared locally regardless */
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(() => {
    const roles = user?.roles ?? [];
    const permissions = user?.permissions ?? [];
    return {
      user,
      profile,
      loading,
      authenticated: Boolean(user),
      demo: isDemoMode(),
      home,
      role: primaryRole(roles),
      hasPermission: (permission: string) => permissions.includes(permission),
      hasRole: (...required: RoleCode[]) => required.some((r) => roles.includes(r)),
      login,
      quickSignIn,
      logout,
      refreshProfile,
    };
  }, [user, profile, loading, home, login, quickSignIn, logout, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
};

/** Convenience hook for permission checks in components and route guards. */
export const usePermission = (permission: string): boolean => {
  const { hasPermission } = useAuth();
  return hasPermission(permission);
};
