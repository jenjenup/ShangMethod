"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  cloudbaseAuth,
  cloudbaseConfigured,
} from "@/lib/cloudbase/client";

export type AuthUser = {
  id: string;
  email?: string | null;
  username?: string | null;
  name?: string | null;
  displayName?: string | null;
  [key: string]: unknown;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  configured: boolean;
  signOut: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(cloudbaseConfigured);

  useEffect(() => {
    if (!cloudbaseAuth) {
      setLoading(false);
      return;
    }

    let mounted = true;

    void cloudbaseAuth
      .getSession()
      .then((result) => {
        if (!mounted) return;
        const currentUser = result.data?.session?.user;
        setUser(currentUser ? normalizeUser(currentUser) : null);
      })
      .catch(() => {
        if (mounted) setUser(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const { data } = cloudbaseAuth.onAuthStateChange(
      (
        _event: unknown,
        session: { user?: unknown } | null,
      ) => {
        if (mounted) {
          setUser(session?.user ? normalizeUser(session.user) : null);
          setLoading(false);
        }
      },
    );

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    if (!cloudbaseAuth) {
      return "CloudBase 尚未配置。";
    }

    try {
      const result = await cloudbaseAuth.signOut();
      if (result && "error" in result && result.error) {
        return result.error.message;
      }
      setUser(null);
      return null;
    } catch (reason) {
      return getErrorMessage(reason);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      configured: cloudbaseConfigured,
      signOut,
    }),
    [loading, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function normalizeUser(value: unknown): AuthUser {
  const source = value as Record<string, unknown>;
  return {
    ...source,
    id: String(source.id),
    email: typeof source.email === "string" ? source.email : null,
    username: typeof source.username === "string" ? source.username : null,
    name: typeof source.name === "string" ? source.name : null,
    displayName:
      typeof source.displayName === "string" ? source.displayName : null,
  };
}

function getErrorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object" && "message" in reason) {
    return String(reason.message);
  }
  return "退出登录失败，请稍后重试。";
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内使用。");
  }

  return context;
}
