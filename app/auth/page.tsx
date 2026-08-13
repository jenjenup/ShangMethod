import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata = {
  title: "登录与注册 · ShangMethod",
};

export default function AuthPage() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="auth-brand" href="/">
          <span className="brand-mark">EL</span>
          <span>ShangMethod</span>
        </Link>
        <div className="auth-heading">
          <p>欢迎回来</p>
          <h1 id="auth-title">继续你的英语学习</h1>
          <span>登录或注册账号。现有本地学习数据不会被改变。</span>
        </div>
        <AuthForm />
      </section>
    </main>
  );
}
