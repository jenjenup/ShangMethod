"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "./auth-provider";

export function AuthStatus() {
  const { user, loading, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  if (loading) {
    return (
      <span className="auth-status-loading" aria-label="正在读取登录状态">
        登录状态…
      </span>
    );
  }

  if (!user) {
    return (
      <Link className="nav-link auth-nav-link" href="/auth">
        登录 / 注册
      </Link>
    );
  }

  const userLabel =
    user.username ?? user.email ?? user.displayName ?? user.name ?? String(user.id);

  const handleSignOut = async () => {
    setSigningOut(true);
    setError("");
    const message = await signOut();
    setError(message ?? "");
    setSigningOut(false);
  };

  return (
    <span className="auth-status">
      <span className="auth-email" title={userLabel}>
        {userLabel}
      </span>
      <button
        className="nav-link auth-sign-out"
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
      >
        {signingOut ? "退出中…" : "退出登录"}
      </button>
      {error ? (
        <span className="auth-status-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
