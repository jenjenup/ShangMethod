import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { auth, cloudbaseConfigured, db } from "./cloudbase";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type SafeSession = {
  user?: unknown;
  access_token?: string;
  refresh_token?: string;
  [key: string]: unknown;
};

type IdentityResult = {
  auth_uid: string | null;
  auth_user_id: string | null;
  identity_matches: boolean;
};

type VocabularyPocRow = {
  id: string;
  lesson_id: string;
  normalized_word: string;
  meaning: string | null;
  write_count: number;
  created_at: string;
  updated_at: string;
};

type IsolationResult = {
  operation: string;
  passed: boolean;
  detail: string;
};

function describeError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (reason && typeof reason === "object") {
    const candidate = reason as Record<string, unknown>;
    const message = typeof candidate.message === "string" ? candidate.message : null;
    const code = typeof candidate.code === "string" ? candidate.code : null;
    const details = typeof candidate.details === "string" ? candidate.details : null;
    const parts = [code, message, details].filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
    try {
      return JSON.stringify(reason);
    } catch {
      return String(reason);
    }
  }
  return String(reason);
}

function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function redactSession(session: SafeSession | null): Json {
  if (!session) return null;
  const copy = { ...session };
  if (copy.access_token) copy.access_token = "[已隐藏]";
  if (copy.refresh_token) copy.refresh_token = "[已隐藏]";
  return copy as Json;
}

function format(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function App() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [verifyOtp, setVerifyOtp] = useState<null | ((params: { token: string }) => Promise<unknown>)>(null);
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [session, setSession] = useState<SafeSession | null>(null);
  const [identity, setIdentity] = useState<IdentityResult | null>(null);
  const [profile, setProfile] = useState<unknown>(null);
  const [vocabularyRows, setVocabularyRows] = useState<VocabularyPocRow[]>([]);
  const [otherUserId, setOtherUserId] = useState("");
  const [isolationResults, setIsolationResults] = useState<IsolationResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const jwt = useMemo(() => decodeJwtPayload(session?.access_token), [session]);

  const refreshSession = useCallback(async () => {
    if (!auth) return;
    const result = await auth.getSession();
    if (result.error) {
      if (result.error.message === "credentials not found") {
        setSession(null);
        setUser(null);
        return;
      }
      throw result.error;
    }
    const current = (result.data?.session ?? null) as SafeSession | null;
    setSession(current);
    setUser((current?.user ?? null) as Record<string, unknown> | null);
  }, []);

  useEffect(() => {
    if (!auth) return;
    void refreshSession().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    const result = auth.onAuthStateChange((_event: unknown, nextSession: unknown) => {
      const current = (nextSession ?? null) as SafeSession | null;
      setSession(current);
      setUser((current?.user ?? null) as Record<string, unknown> | null);
      setIdentity(null);
      setProfile(null);
      setVocabularyRows([]);
      setIsolationResults([]);
    });
    return () => result.data?.subscription?.unsubscribe();
  }, [refreshSession]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  const register = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!auth) throw new Error("CloudBase PoC 尚未配置环境ID或地域。");
      const result = await auth.signUp({
        email: email.trim(),
        username: username.trim(),
        password,
      });
      if (result.error) throw result.error;
      if (!result.data?.verifyOtp) throw new Error("注册接口没有返回验证码确认方法。");
      setVerifyOtp(() => result.data.verifyOtp!);
      setMessage("验证码已发送到邮箱，请输入验证码完成注册。");
    });
  };

  const confirmRegistration = () => {
    void run(async () => {
      if (!verifyOtp) throw new Error("请先发送注册验证码。");
      const result = await verifyOtp({ token: otp.trim() }) as {
        data?: { user?: Record<string, unknown>; session?: SafeSession };
        error?: Error | null;
      };
      if (result.error) throw result.error;
      setVerifyOtp(null);
      setSession(result.data?.session ?? null);
      setUser(result.data?.user ?? null);
      setMessage("注册并登录成功。");
    });
  };

  const login = () => {
    void run(async () => {
      if (!auth) throw new Error("CloudBase PoC 尚未配置环境ID或地域。");
      const result = await auth.signInWithPassword({ username: username.trim(), password });
      if (result.error) throw result.error;
      setSession(result.data?.session as SafeSession);
      setUser(result.data?.user as Record<string, unknown>);
      setMessage("用户名密码登录成功。");
    });
  };

  const logout = () => {
    void run(async () => {
      if (!auth) return;
      const result = await auth.signOut();
      if (result.error) throw result.error;
      setSession(null);
      setUser(null);
      setMessage("已退出登录。");
    });
  };

  const inspectIdentity = () => {
    void run(async () => {
      if (!db) throw new Error("CloudBase数据库客户端尚未配置。");
      const result = await db.rpc("poc_current_identity");
      if (result.error) throw result.error;
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!row) {
        throw new Error(
          "身份RPC没有返回当前用户记录。请确认 poc_current_identity 已在 CloudBase SQL 编辑器执行，并检查函数是否能匹配当前 auth.users.id。",
        );
      }
      setIdentity(row as IdentityResult);
      setMessage("已通过只读RPC读取当前数据库身份。");
    });
  };

  const testProfileRls = () => {
    void run(async () => {
      if (!db || !user?.id) throw new Error("请先登录。");
      const userId = String(user.id);
      if (!/^\d+$/.test(userId)) {
        throw new Error("Web SDK user.id不是纯数字CloudBase用户ID。");
      }
      const write = await db.from("profiles").upsert({
        id: userId,
        display_name: "CloudBase PoC User",
      });
      if (write.error) throw write.error;
      const read = await db
        .from("profiles")
        .select("display_name,created_at,updated_at")
        .eq("id", userId)
        .single();
      if (read.error) throw read.error;
      setProfile({ queried_user_id: userId, ...read.data });
      setMessage("profiles写入和读取成功；请求使用当前用户Session并受RLS约束。");
    });
  };

  const currentUserId = () => {
    const userId = String(user?.id ?? "");
    if (!/^\d+$/.test(userId)) {
      throw new Error("Web SDK user.id不是纯数字CloudBase用户ID。");
    }
    return userId;
  };

  const readOwnVocabulary = async () => {
    if (!db) throw new Error("CloudBase数据库客户端尚未配置。");
    const result = await db
      .from("poc_vocabulary_entries")
      .select("id,lesson_id,normalized_word,meaning,write_count,created_at,updated_at")
      .order("created_at", { ascending: true });
    if (result.error) throw result.error;
    setVocabularyRows((result.data ?? []) as VocabularyPocRow[]);
    return (result.data ?? []) as VocabularyPocRow[];
  };

  const testVocabularyUpsert = () => {
    void run(async () => {
      if (!db) throw new Error("CloudBase数据库客户端尚未配置。");
      const userId = currentUserId();
      const conflictColumns = "user_id,lesson_id,normalized_word";
      const first = await db.from("poc_vocabulary_entries").upsert(
        {
          user_id: userId,
          lesson_id: "cloudbase-poc-lesson",
          normalized_word: "identity",
          meaning: "第一次写入",
          write_count: 1,
        },
        { onConflict: conflictColumns },
      );
      if (first.error) throw first.error;

      const second = await db.from("poc_vocabulary_entries").upsert(
        {
          user_id: userId,
          lesson_id: "cloudbase-poc-lesson",
          normalized_word: "identity",
          meaning: "第二次写入：联合唯一键已更新同一行",
          write_count: 2,
        },
        { onConflict: conflictColumns },
      );
      if (second.error) throw second.error;

      const rows = await readOwnVocabulary();
      const matches = rows.filter(
        (row) =>
          row.lesson_id === "cloudbase-poc-lesson" &&
          row.normalized_word === "identity",
      );
      if (matches.length !== 1 || matches[0]?.write_count !== 2) {
        throw new Error(`联合唯一键upsert验证失败：匹配到 ${matches.length} 行。`);
      }
      setMessage("字符串user_id写入成功；重复upsert只保留一行并更新为第二次内容。");
    });
  };

  const testOtherUserIsolation = () => {
    void run(async () => {
      if (!db) throw new Error("CloudBase数据库客户端尚未配置。");
      const currentId = currentUserId();
      const targetId = otherUserId.trim();
      if (!/^\d+$/.test(targetId) || targetId === currentId) {
        throw new Error("请输入另一个测试账号的纯数字user.id。");
      }

      const results: IsolationResult[] = [];
      const read = await db
        .from("poc_vocabulary_entries")
        .select("id,lesson_id,normalized_word,meaning,write_count")
        .eq("user_id", targetId);
      if (read.error) throw read.error;
      const visibleCount = (read.data ?? []).length;
      results.push({
        operation: "读取另一个账号数据",
        passed: visibleCount === 0,
        detail: visibleCount === 0 ? "返回0行，RLS已隔离" : `错误地返回${visibleCount}行`,
      });

      const spoof = await db.from("poc_vocabulary_entries").insert({
        user_id: targetId,
        lesson_id: "cloudbase-poc-spoof",
        normalized_word: "forbidden",
        meaning: "这条伪造写入必须失败",
      });
      results.push({
        operation: "伪造另一个账号user_id写入",
        passed: Boolean(spoof.error),
        detail: spoof.error ? `已拒绝：${describeError(spoof.error)}` : "错误：伪造写入成功",
      });

      setIsolationResults(results);
      if (results.every((result) => result.passed)) {
        setMessage("跨账号读取和伪造写入均被RLS阻止。");
      } else {
        throw new Error("用户隔离测试未全部通过，请查看结果。");
      }
    });
  };

  return (
    <main>
      <header>
        <p>隔离测试工具</p>
        <h1>CloudBase Auth + PostgreSQL PoC</h1>
        <span>环境：shangmethod-poc-d7fuug6m5e37ad8d · 上海</span>
      </header>

      {!cloudbaseConfigured ? <div className="notice error">缺少 CloudBase 环境ID或地域，请先配置 cloudbase-poc/.env.local。</div> : null}
      {message ? <div className="notice success">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <section>
        <h2>1. 注册与登录</h2>
        <form onSubmit={register}>
          <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} minLength={5} required /></label>
          <label>邮箱（注册时使用）<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <div className="actions">
            <button disabled={busy || !email} type="submit">发送注册验证码</button>
            <button disabled={busy} type="button" onClick={login}>用户名密码登录</button>
            <button disabled={busy || !user} type="button" onClick={logout}>退出登录</button>
          </div>
        </form>
        {verifyOtp ? <div className="otp"><label>邮箱验证码<input value={otp} onChange={(e) => setOtp(e.target.value)} /></label><button disabled={busy || !otp} onClick={confirmRegistration}>确认注册</button></div> : null}
      </section>

      <section>
        <h2>2. Session 与身份</h2>
        <div className="actions"><button disabled={busy} onClick={() => void run(refreshSession)}>重新读取Session</button><button disabled={busy || !user} onClick={inspectIdentity}>读取数据库身份</button></div>
        <div className="grid">
          <article><h3>Web SDK user.id</h3><pre>{String(user?.id ?? "未登录")}</pre></article>
          <article><h3>JWT sub</h3><pre>{String(jwt?.sub ?? "不可用")}</pre></article>
          <article><h3>数据库身份RPC</h3><pre>{format(identity)}</pre></article>
        </div>
        <details><summary>完整user对象</summary><pre>{format(user)}</pre></details>
        <details><summary>Session（Token全文已隐藏）</summary><pre>{format(redactSession(session))}</pre></details>
        <details><summary>JWT payload（不含Token全文）</summary><pre>{format(jwt)}</pre></details>
      </section>

      <section>
        <h2>3. profiles RLS最小测试</h2>
        <p>只用当前登录用户Session写入自己的ID，不使用管理员Key。</p>
        <button disabled={busy || !user} onClick={testProfileRls}>写入并读取我的profile</button>
        <pre>{format(profile)}</pre>
      </section>

      <section>
        <h2>4. vocabulary业务表PoC</h2>
        <p>使用独立表验证19位字符串user_id、联合唯一键upsert和RLS隔离。</p>
        <div className="actions">
          <button disabled={busy || !user} onClick={testVocabularyUpsert}>连续执行两次upsert</button>
          <button disabled={busy || !user} onClick={() => void run(async () => { await readOwnVocabulary(); setMessage("已读取当前账号可见的数据。"); })}>读取我的测试数据</button>
        </div>
        <pre>{format(vocabularyRows)}</pre>

        <h3>双账号隔离测试</h3>
        <p>先用账号A创建数据，再登录账号B，把账号A的user.id填在下面。</p>
        <label>另一个账号的user.id<input value={otherUserId} onChange={(event) => setOtherUserId(event.target.value)} inputMode="numeric" /></label>
        <button disabled={busy || !user || !otherUserId.trim()} onClick={testOtherUserIsolation}>验证无法读取及伪造写入</button>
        <pre>{format(isolationResults)}</pre>
      </section>
    </main>
  );
}
