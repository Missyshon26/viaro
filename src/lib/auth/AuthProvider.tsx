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

/** Who may use this console. Anyone else is treated as a failed sign-in, not shown a screen. */
const CONSOLE_ROLES: UserRole[] = ["admin"];
const BAD_LOGIN = "Incorrect email or password.";

/**
 * The last signed-in person, kept only so the console can draw itself at once on a refresh
 * instead of showing a "checking your session" screen while the cookie is exchanged. It is a
 * hint for the screen, never proof: no token is stored, and every API call is checked by the
 * server regardless.
 */
const CACHE_KEY = "abl-console-user";

function readCachedUser(): User | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const user = raw ? (JSON.parse(raw) as User) : null;
    return user && CONSOLE_ROLES.includes(user.role) ? user : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null) {
  try {
    if (!user) {
      window.localStorage.removeItem(CACHE_KEY);
      return;
    }
    const { _id, name, email, role } = user;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ _id, name, email, role }));
  } catch {
    /* Storage blocked: the console just shows its brief loading state instead. */
  }
}

/** Ends a session the console should never have started, so no cookie is left behind. */
async function endSession(token: string | null) {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }).catch(() => undefined);
  setAccessToken(null);
  writeCachedUser(null);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      const profile = await api.get<User>("/users/me");
      if (!CONSOLE_ROLES.includes(profile.role)) {
        // A passenger's or chauffeur's session left in this browser: sign it out quietly.
        await endSession(getAccessToken());
        setUser(null);
        return;
      }
      setUser(profile);
      writeCachedUser(profile);
    } catch {
      setUser(null);
      writeCachedUser(null);
    }
  }, []);

  // On first mount the access token is gone (memory only), so try the refresh
  // cookie before deciding the visitor is logged out.
  useEffect(() => {
    let cancelled = false;

    // Someone who was signed in a moment ago sees the console immediately; the session is
    // confirmed behind it, and a failed restore sends them to the sign-in screen.
    const cached = readCachedUser();
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after mount
      setUser(cached);
      setLoading(false);
    }

    (async () => {
      const restored = await refreshSession();
      if (!cancelled && restored) await loadProfile();
      else if (!cancelled) {
        setUser(null);
        writeCachedUser(null);
      }
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

    // Right password, wrong kind of account: to this console that is just a wrong login.
    if (!CONSOLE_ROLES.includes(data.user?.role)) {
      await endSession(data.accessToken);
      throw new Error(BAD_LOGIN);
    }

    setAccessToken(data.accessToken);
    setUser(data.user);
    writeCachedUser(data.user);
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
    writeCachedUser(null);
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
