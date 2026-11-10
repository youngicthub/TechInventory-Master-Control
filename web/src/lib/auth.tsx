import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, getToken, setToken, type Admin } from "./api";

interface AuthContextValue {
  admin: Admin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** True when the signed-in admin's role includes this permission (the server still enforces it). */
  can: (permission: string) => boolean;
  /** Replace the session after an action that re-issues the token (e.g. changing password). */
  adoptSession: (token: string, admin: Admin) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!getToken()) {
      setAdmin(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<Admin>("/admin/me");
      setAdmin(me);
    } catch (err) {
      // Token expired/invalid - drop it and fall back to the login screen
      // rather than looping on a request that will only ever fail.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setToken(null);
      }
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string) {
    const result = await api.post<{ token: string; admin: Admin }>("/admin/login", { email, password });
    setToken(result.token);
    setAdmin(result.admin);
  }

  function logout() {
    // Best-effort: ends this admin's sessions on every device. Clearing the
    // local token happens regardless, so a down API never traps someone logged in.
    api.post("/admin/logout").catch(() => undefined).finally(() => {
      setToken(null);
      setAdmin(null);
    });
  }

  function adoptSession(nextToken: string, nextAdmin: Admin) {
    setToken(nextToken);
    setAdmin(nextAdmin);
  }

  return (
    <AuthContext.Provider value={{ admin, loading, login, logout, refresh, adoptSession, can: (p: string) => !!admin?.permissions?.includes(p) }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
