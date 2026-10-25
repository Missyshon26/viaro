"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, refreshSession, setAccessToken, getAccessToken } from "@/lib/api/client";
import type { User, UserRole } from "@/lib/api/types";

interface AuthState {
  user: User | null;
  role: UserRole | null;
  /** True until the initial silent refresh has settled — guards route redirects. */
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      const profile = await api.get<User>("/users/me");
      setUser(profile);
    } catch {
      setUser(null);
    }
  }, []);

  // On first mount the access token is gone (memory only), so try the refresh
  // cookie before deciding the visitor is logged out.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const restored = await refreshSession();
      if (!cancelled && restored) await loadProfile();
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message ?? "Could not sign you in");

    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user as User;
  }, []);

  const logout = useCallback(async () => {
    const token = getAccessToken();
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).catch(() => undefined);

    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, role: user?.role ?? null, loading, login, logout, reload: loadProfile }),
    [user, loading, login, logout, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

/*
 * A HOME_BY_ROLE map used to live here, routing four roles to paths like /company/drivers.
 * It was never imported anywhere and none of those routes exist in this single-role
 * console — left in place it reads as live routing config.
 */
