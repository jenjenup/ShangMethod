"use client";

import { cloudbaseDb } from "./client";
import { getTranscriptVersion } from "./transcript-version";

const dictationStoragePrefix = "shangmethod:dictation:";
const uploadBatchSize = 200;
const syncDelayMs = 1000;
const pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>();
const pausedUsers = new Set<string>();

export type LocalDraft = {
  lessonId: string;
  content: string;
};

export type DraftConflict = {
  lessonId: string;
  localContent: string;
  cloudContent: string;
};

type CloudDraft = {
  lesson_id: string;
  content: string | null;
};

type DraftUploadRow = {
  user_id: string;
  lesson_id: string;
  content: string;
  transcript_version: number | null;
};

export function readLocalDictationDrafts(): LocalDraft[] {
  const drafts: LocalDraft[] = [];

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(dictationStoragePrefix)) continue;

      const lessonId = key.slice(dictationStoragePrefix.length).trim();
      if (!lessonId) continue;
      drafts.push({
        lessonId,
        content: window.localStorage.getItem(key) ?? "",
      });
    }
  } catch {
    return [];
  }

  return drafts;
}

export async function hasCompletedDictationImport(userId: string) {
  const db = requireDatabase();
  const result = await db
    .from("user_sync_state")
    .select("dictation_import_completed_at")
    .eq("user_id", String(userId))
    .maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data?.dictation_import_completed_at);
}

export async function prepareInitialDictationSync(userId: string) {
  const db = requireDatabase();
  const safeUserId = String(userId);
  const localDrafts = readLocalDictationDrafts();
  const cloudResult = await db
    .from("dictation_drafts")
    .select("lesson_id,content")
    .eq("user_id", safeUserId);
  if (cloudResult.error) throw cloudResult.error;

  const cloudByLesson = new Map(
    ((cloudResult.data ?? []) as CloudDraft[]).map((draft) => [
      draft.lesson_id,
      draft.content ?? "",
    ]),
  );
  const uploads: DraftUploadRow[] = [];
  const conflicts: DraftConflict[] = [];

  localDrafts.forEach((draft) => {
    if (!cloudByLesson.has(draft.lessonId)) {
      uploads.push({
        user_id: safeUserId,
        lesson_id: draft.lessonId,
        content: draft.content,
        transcript_version: getTranscriptVersion(draft.lessonId),
      });
      return;
    }

    const cloudContent = cloudByLesson.get(draft.lessonId) ?? "";
    if (cloudContent !== draft.content) {
      conflicts.push({
        lessonId: draft.lessonId,
        localContent: draft.content,
        cloudContent,
      });
    }
  });

  if (conflicts.length > 0) {
    pauseDictationSync(safeUserId);
  }

  for (let index = 0; index < uploads.length; index += uploadBatchSize) {
    const result = await db
      .from("dictation_drafts")
      .upsert(uploads.slice(index, index + uploadBatchSize), {
        onConflict: "user_id,lesson_id",
      });
    if (result.error) throw result.error;
  }

  if (conflicts.length === 0) {
    await finishDictationImport(safeUserId);
  }

  return conflicts;
}

export async function resolveDictationConflict(
  userId: string,
  conflict: DraftConflict,
  choice: "local" | "cloud",
) {
  const safeUserId = String(userId);

  if (choice === "local") {
    await syncDictationDraft(safeUserId, conflict.lessonId, conflict.localContent);
    return;
  }

  window.localStorage.setItem(
    `${dictationStoragePrefix}${conflict.lessonId}`,
    conflict.cloudContent,
  );
}

export async function finishDictationImport(userId: string) {
  const db = requireDatabase();
  const syncedAt = new Date().toISOString();
  const result = await db.from("user_sync_state").upsert(
    {
      user_id: String(userId),
      schema_version: 1,
      dictation_import_completed_at: syncedAt,
      last_sync_at: syncedAt,
    },
    { onConflict: "user_id" },
  );
  if (result.error) throw result.error;
  pausedUsers.delete(String(userId));
}

export async function syncDictationDraft(
  userId: string,
  lessonId: string,
  content: string,
) {
  const db = requireDatabase();
  const result = await db.from("dictation_drafts").upsert(
    {
      user_id: String(userId),
      lesson_id: lessonId,
      content,
      transcript_version: getTranscriptVersion(lessonId),
    },
    { onConflict: "user_id,lesson_id" },
  );
  if (result.error) throw result.error;
}

export function scheduleDictationDraftSync(
  userId: string,
  lessonId: string,
  content: string,
) {
  const safeUserId = String(userId);
  if (pausedUsers.has(safeUserId)) return;
  const timerKey = `${safeUserId}:${lessonId}`;
  const existingTimer = pendingSyncs.get(timerKey);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    pendingSyncs.delete(timerKey);
    void syncDictationDraft(safeUserId, lessonId, content).catch(() => {
      // Local storage remains authoritative when background sync fails.
    });
  }, syncDelayMs);
  pendingSyncs.set(timerKey, timer);
}

function pauseDictationSync(userId: string) {
  const safeUserId = String(userId);
  pausedUsers.add(safeUserId);
  for (const [timerKey, timer] of pendingSyncs) {
    if (timerKey.startsWith(`${safeUserId}:`)) {
      clearTimeout(timer);
      pendingSyncs.delete(timerKey);
    }
  }
}

function requireDatabase() {
  if (!cloudbaseDb) throw new Error("CloudBase 数据库尚未配置。");
  return cloudbaseDb;
}
