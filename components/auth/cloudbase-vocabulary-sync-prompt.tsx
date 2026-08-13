"use client";

import { useEffect, useState } from "react";
import {
  hasCompletedVocabularyImport,
  importLocalVocabulary,
  readLocalVocabularyForSync,
} from "@/lib/cloudbase/vocabulary";
import { useAuth } from "./auth-provider";

type SyncEntries = ReturnType<typeof readLocalVocabularyForSync>;
type PromptState =
  | { phase: "hidden" }
  | { phase: "prompt"; userId: string; entries: SyncEntries }
  | { phase: "syncing"; userId: string; entries: SyncEntries }
  | { phase: "success"; userId: string; count: number }
  | { phase: "error"; userId: string; message: string; entries: SyncEntries };

export function CloudBaseVocabularySyncPrompt({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const { user, loading: authLoading } = useAuth();
  const [promptState, setPromptState] = useState<PromptState>({
    phase: "hidden",
  });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (authLoading || !user) return;

    let cancelled = false;
    const userId = String(user.id);

    const inspectVocabulary = async () => {
      const entries = readLocalVocabularyForSync(userId);
      if (entries.length === 0) {
        if (!cancelled) onComplete();
        return;
      }

      try {
        const completed = await hasCompletedVocabularyImport(userId);
        if (!cancelled) {
          if (completed) onComplete();
          else setPromptState({ phase: "prompt", userId, entries });
        }
      } catch (reason) {
        if (!cancelled) {
          setPromptState({
            phase: "error",
            userId,
            message: `无法检查生词同步状态：${getErrorMessage(reason)}`,
            entries,
          });
        }
      }
    };

    void inspectVocabulary();
    return () => {
      cancelled = true;
    };
  }, [authLoading, onComplete, retryCount, user]);

  if (
    !user ||
    promptState.phase === "hidden" ||
    promptState.userId !== String(user.id)
  ) {
    return null;
  }

  const entries = "entries" in promptState ? promptState.entries : [];

  const syncVocabulary = async () => {
    const userId = String(user.id);
    setPromptState({ phase: "syncing", userId, entries });
    try {
      await importLocalVocabulary(userId, entries);
      setPromptState({ phase: "success", userId, count: entries.length });
    } catch (reason) {
      setPromptState({
        phase: "error",
        userId,
        message: `生词同步失败：${getErrorMessage(reason)}`,
        entries,
      });
    }
  };

  return (
    <div className="sync-prompt-backdrop" role="presentation">
      <section
        className="sync-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vocabulary-sync-title"
      >
        {promptState.phase === "success" ? (
          <>
            <p className="sync-prompt-label">同步完成</p>
            <h2 id="vocabulary-sync-title">
              已保存 {promptState.count} 个生词
            </h2>
            <p>本地生词仍然保留，之后可以继续在当前浏览器使用。</p>
            <button
              className="sync-prompt-primary"
              type="button"
              onClick={onComplete}
            >
              知道了
            </button>
          </>
        ) : (
          <>
            <p className="sync-prompt-label">生词本云同步</p>
            <h2 id="vocabulary-sync-title">
              发现本地已有 {entries.length} 个生词
            </h2>
            <p>是否同步到当前账号？同步后不会删除本地数据。</p>
            {promptState.phase === "error" ? (
              <p className="sync-prompt-error" role="alert">
                {promptState.message}
              </p>
            ) : null}
            <div className="sync-prompt-actions">
              <button
                className="sync-prompt-primary"
                type="button"
                disabled={promptState.phase === "syncing"}
                onClick={() => void syncVocabulary()}
              >
                {promptState.phase === "syncing"
                  ? "正在同步…"
                  : promptState.phase === "error"
                    ? "重试同步"
                    : "同步到账号"}
              </button>
              <button
                className="sync-prompt-secondary"
                type="button"
                disabled={promptState.phase === "syncing"}
                onClick={onComplete}
              >
                暂不处理
              </button>
            </div>
            {promptState.phase === "error" ? (
              <button
                className="sync-prompt-check-again"
                type="button"
                onClick={() => {
                  setPromptState({ phase: "hidden" });
                  setRetryCount((count) => count + 1);
                }}
              >
                重新检查同步状态
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function getErrorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object" && "message" in reason) {
    return String(reason.message);
  }
  return "未知错误";
}
