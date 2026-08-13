import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/auth-provider";
import { CloudBaseSyncOrchestrator } from "@/components/auth/cloudbase-sync-orchestrator";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShangMethod",
  description: "ShangMethod 是一个专注于精听、听写、精学与背诵的英语学习工具。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthProvider>
          <CloudBaseSyncOrchestrator />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
