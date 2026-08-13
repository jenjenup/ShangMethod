"use client";

import { useEffect, useState } from "react";
import {
  hasCompletedLearningRecordsImport,
  importLocalLearningRecords,
  readLocalLearningRecordsForSync,
} from "@/lib/cloudbase/learning-records";
import { useAuth } from "./auth-provider";

type SyncEntries = ReturnType<typeof readLocalLearningRecordsForSync>;
type PromptState =
  | { phase: "hidden" }
  | { phase: "prompt"; userId: string; entries: SyncEntries }
  | { phase: "syncing"; userId: string; entries: SyncEntries }
  | { phase: "success"; userId: string; count: number }
  | { phase: "error"; userId: string; message: string; entries: SyncEntries };

export function CloudBaseLearningRecordsSyncPrompt({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const { user, loading: authLoading } = useAuth();
  const [promptState, setPromptState] = useState<PromptState>({ phase: "hidden" });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    const userId = String(user.id);

    const inspectRecords = async () => {
      const entries = readLocalLearningRecordsForSync(userId);
      if (entries.length === 0) {
        if (!cancelled) onComplete();
        return;
      }
      try {
        const completed = await hasCompletedLearningRecordsImport(userId);
        if (!cancelled) {
          if (completed) onComplete();
          else setPromptState({ phase: "prompt", userId, entries });
        }
      } catch (reason) {
        if (!cancelled) {
          setPromptState({
            phase: "error",
            userId,
            message: `无法检查学习记录同步状态：${getErrorMessage(reason)}`,
            entries,
          });
        }
      }
    };

    void inspectRecords();
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
  const syncRecords = async () => {
    const userId = String(user.id);
    setPromptState({ phase: "syncing", userId, entries });
    try {
      const count = await importLocalLearningRecords(userId, entries);
      setPromptState({ phase: "success", userId, count });
    } catch (reason) {
      setPromptState({
        phase: "error",
        userId,
        message: `学习记录同步失败：${getErrorMessage(reason)}`,
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
        aria-labelledby="learning-records-sync-title"
      >
        {promptState.phase === "success" ? (
          <>
            <p className="sync-prompt-label">同步完成</p>
            <h2 id="learning-records-sync-title">
              已保存 {promptState.count} 条学习记录
            </h2>
            <p>本地学习记录仍然保留，不会被删除。</p>
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
            <p className="sync-prompt-label">学习记录云同步</p>
            <h2 id="learning-records-sync-title">
              发现本地已有 {entries.length} 条学习记录
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
                onClick={() => void syncRecords()}
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
