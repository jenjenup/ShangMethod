"use client";

import { useEffect, useState } from "react";
import lessonListData from "@/public/lessons/lessons.json";
import {
  type DraftConflict,
  finishDictationImport,
  hasCompletedDictationImport,
  prepareInitialDictationSync,
  resolveDictationConflict,
} from "@/lib/cloudbase/dictation-drafts";
import { useAuth } from "./auth-provider";

type PromptState =
  | { phase: "hidden" }
  | { phase: "conflict"; userId: string; conflicts: DraftConflict[] }
  | { phase: "error"; userId: string; message: string };

const lessonTitles = new Map(
  (lessonListData as Array<{ id: string; title: string }>).map((lesson) => [
    lesson.id,
    lesson.title,
  ]),
);

export function CloudBaseDictationSyncPrompt({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const { user, loading: authLoading } = useAuth();
  const [promptState, setPromptState] = useState<PromptState>({ phase: "hidden" });
  const [retryCount, setRetryCount] = useState(0);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    const userId = String(user.id);

    const inspectAndSync = async () => {
      try {
        if (await hasCompletedDictationImport(userId)) {
          if (!cancelled) onComplete();
          return;
        }
        const conflicts = await prepareInitialDictationSync(userId);
        if (!cancelled) {
          if (conflicts.length > 0) {
            setPromptState({ phase: "conflict", userId, conflicts });
          } else {
            onComplete();
          }
        }
      } catch (reason) {
        if (!cancelled) {
          setPromptState({
            phase: "error",
            userId,
            message: `听写草稿同步失败：${getErrorMessage(reason)}`,
          });
        }
      }
    };

    void inspectAndSync();
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

  if (promptState.phase === "error") {
    return (
      <div className="sync-prompt-backdrop" role="presentation">
        <section
          className="sync-prompt"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dictation-sync-error-title"
        >
          <p className="sync-prompt-label">听写草稿云同步</p>
          <h2 id="dictation-sync-error-title">暂时无法完成同步</h2>
          <p className="sync-prompt-error" role="alert">{promptState.message}</p>
          <div className="sync-prompt-actions">
            <button
              className="sync-prompt-primary"
              type="button"
              onClick={() => {
                setPromptState({ phase: "hidden" });
                setRetryCount((count) => count + 1);
              }}
            >
              重试
            </button>
            <button
              className="sync-prompt-secondary"
              type="button"
              onClick={onComplete}
            >
              暂不处理
            </button>
          </div>
        </section>
      </div>
    );
  }

  const conflict = promptState.conflicts[0];
  if (!conflict) return null;

  const chooseVersion = async (choice: "local" | "cloud") => {
    setResolving(true);
    try {
      await resolveDictationConflict(String(user.id), conflict, choice);
      const remainingConflicts = promptState.conflicts.slice(1);
      if (remainingConflicts.length > 0) {
        setPromptState({
          phase: "conflict",
          userId: String(user.id),
          conflicts: remainingConflicts,
        });
      } else {
        await finishDictationImport(String(user.id));
        onComplete();
      }
    } catch (reason) {
      setPromptState({
        phase: "error",
        userId: String(user.id),
        message: `听写版本处理失败：${getErrorMessage(reason)}`,
      });
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="sync-prompt-backdrop" role="presentation">
      <section
        className="sync-prompt sync-prompt-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dictation-sync-title"
      >
        <p className="sync-prompt-label">听写草稿存在冲突</p>
        <h2 id="dictation-sync-title">
          《{lessonTitles.get(conflict.lessonId) ?? conflict.lessonId}》
        </h2>
        <p>
          本地和云端存在两个版本，请选择需要保留的听写内容。
          {promptState.conflicts.length > 1
            ? ` 还有 ${promptState.conflicts.length - 1} 门课程待处理。`
            : ""}
        </p>
        <div className="dictation-conflict-versions">
          <article>
            <strong>本地版本</strong>
            <pre>{conflict.localContent || "（空白内容）"}</pre>
          </article>
          <article>
            <strong>云端版本</strong>
            <pre>{conflict.cloudContent || "（空白内容）"}</pre>
          </article>
        </div>
        <div className="sync-prompt-actions">
          <button
            className="sync-prompt-primary"
            type="button"
            disabled={resolving}
            onClick={() => void chooseVersion("local")}
          >
            {resolving ? "正在保存…" : "使用本地"}
          </button>
          <button
            className="sync-prompt-secondary"
            type="button"
            disabled={resolving}
            onClick={() => void chooseVersion("cloud")}
          >
            使用云端
          </button>
        </div>
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
