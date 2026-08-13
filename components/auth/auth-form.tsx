"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { cloudbaseAuth } from "@/lib/cloudbase/client";
import { useAuth } from "./auth-provider";

type AuthMode = "login" | "register";
type VerifyOtp = (params: { token: string }) => Promise<unknown>;

export function AuthForm() {
  const router = useRouter();
  const { user, loading: sessionLoading, configured, signOut } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [verifyOtp, setVerifyOtp] = useState<VerifyOtp | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    if (!cloudbaseAuth) {
      setError("CloudBase 尚未配置，请先设置环境变量。");
      setLoading(false);
      return;
    }

    try {
      if (mode === "register") {
        const result = await cloudbaseAuth.signUp({
          username: username.trim(),
          password,
          email: email.trim(),
        });

        if (result.error) throw result.error;

        if (result.data?.session) {
          router.push("/");
          router.refresh();
        } else if (result.data?.verifyOtp) {
          setVerifyOtp(() => result.data.verifyOtp as VerifyOtp);
          setMessage("验证码已发送到邮箱，请输入验证码完成注册。");
        } else {
          setError("注册请求未返回验证码确认步骤，请稍后重试。");
        }
      } else {
        const result = await cloudbaseAuth.signInWithPassword({
          username: username.trim(),
          password,
        });
        if (result.error) throw result.error;
        router.push("/");
        router.refresh();
      }
    } catch (reason) {
      setError(getErrorMessage(reason));
    }

    setLoading(false);
  };

  const handleConfirmRegistration = async () => {
    if (!verifyOtp) return;

    setLoading(true);
    setMessage("");
    setError("");

    try {
      const result = (await verifyOtp({ token: otp.trim() })) as {
        data?: { session?: unknown; user?: unknown };
        error?: { message?: string } | null;
      };

      if (result.error) throw result.error;
      if (!result.data?.session) {
        throw new Error("验证码已确认，但未建立登录状态，请返回登录页重试。");
      }

      setVerifyOtp(null);
      setOtp("");
      router.push("/");
      router.refresh();
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    setError("");
    const signOutError = await signOut();
    setError(signOutError ?? "");
    setLoading(false);
  };

  if (sessionLoading) {
    return <p className="auth-page-state">正在读取登录状态…</p>;
  }

  if (user) {
    const userLabel =
      user.username ?? user.email ?? user.displayName ?? user.name ?? String(user.id);

    return (
      <div className="auth-signed-in">
        <p>当前已登录</p>
        <strong>{userLabel}</strong>
        <div className="auth-signed-in-actions">
          <Link className="auth-secondary-button" href="/">
            返回学习
          </Link>
          <button
            className="auth-primary-button"
            type="button"
            onClick={handleSignOut}
            disabled={loading}
          >
            {loading ? "退出中…" : "退出登录"}
          </button>
        </div>
        {error ? <p className="auth-form-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <>
      <div className="auth-mode-switch" aria-label="选择登录或注册">
        <button
          className={mode === "login" ? "is-active" : ""}
          type="button"
          onClick={() => {
            setMode("login");
            setVerifyOtp(null);
            setOtp("");
            setError("");
            setMessage("");
          }}
        >
          登录
        </button>
        <button
          className={mode === "register" ? "is-active" : ""}
          type="button"
          onClick={() => {
            setMode("register");
            setVerifyOtp(null);
            setOtp("");
            setError("");
            setMessage("");
          }}
        >
          注册
        </button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          用户名
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="请输入用户名"
            required
          />
        </label>
        {mode === "register" ? (
          <label>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="用于接收注册验证码"
              required
            />
          </label>
        ) : null}
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            placeholder="至少 6 位"
            required
          />
        </label>

        <button
          className="auth-primary-button"
          type="submit"
          disabled={loading || !configured}
        >
          {loading ? "请稍候…" : mode === "login" ? "登录" : "创建账号"}
        </button>
      </form>

      {mode === "register" && verifyOtp ? (
        <div className="auth-form">
          <label>
            邮箱验证码
            <input
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              autoComplete="one-time-code"
              placeholder="请输入邮箱中的验证码"
              required
            />
          </label>
          <button
            className="auth-primary-button"
            type="button"
            disabled={loading || !otp.trim()}
            onClick={() => void handleConfirmRegistration()}
          >
            {loading ? "正在确认…" : "确认注册"}
          </button>
        </div>
      ) : null}

      {!configured ? (
        <p className="auth-form-error">CloudBase 尚未配置，请先设置环境变量。</p>
      ) : null}
      {error ? (
        <p className="auth-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="auth-form-message" role="status">
          {message}
        </p>
      ) : null}
    </>
  );
}

function getErrorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object" && "message" in reason) {
    return String(reason.message);
  }
  return "认证请求失败，请稍后重试。";
}
