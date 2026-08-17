"use client";

import { cloudbaseDb } from "./client";
import { getTranscriptVersion } from "./transcript-version";

const learningRecordsStorageKey = "shangmethod:learning-records";
const uploadBatchSize = 200;

export type LocalLearningRecord = {
  lessonId: string;
  lessonTitle: string;
  status: "in-progress" | "completed";
  lastStudiedAt: string;
  recitationCompleted: boolean;
  proficiency: string;
};

type StoredLearningRecord = {
  lessonId?: unknown;
  lessonTitle?: unknown;
  status?: unknown;
  lastStudiedAt?: unknown;
  recitationCompleted?: unknown;
  proficiency?: unknown;
};

export type LearningRecordRow = {
  user_id: string;
  lesson_id: string;
  lesson_title: string | null;
  status: "in-progress" | "completed";
  last_studied_at: string | null;
  recitation_completed: boolean;
  proficiency: string | null;
  transcript_version: number | null;
};

type CloudLearningRecord = Omit<LearningRecordRow, "user_id">;

export function readLocalLearningRecordsForSync(
  userId: string,
): LearningRecordRow[] {
  const safeUserId = String(userId);

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(learningRecordsStorageKey) ?? "[]",
    ) as unknown;
    if (!Array.isArray(stored)) return [];

    const recordsByLesson = new Map<string, LearningRecordRow>();
    stored.forEach((item: StoredLearningRecord) => {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.lessonId !== "string"
      ) {
        return;
      }

      const lessonId = item.lessonId.trim();
      if (!lessonId) return;

      const record: LearningRecordRow = {
        user_id: safeUserId,
        lesson_id: lessonId,
        lesson_title:
          typeof item.lessonTitle === "string" && item.lessonTitle.trim()
            ? item.lessonTitle.trim()
            : null,
        status: item.status === "completed" ? "completed" : "in-progress",
        last_studied_at: normalizeTimestamp(item.lastStudiedAt),
        recitation_completed: item.recitationCompleted === true,
        proficiency:
          typeof item.proficiency === "string" ? item.proficiency : null,
        transcript_version: getTranscriptVersion(lessonId),
      };
      const existing = recordsByLesson.get(lessonId);
      recordsByLesson.set(
        lessonId,
        existing ? mergeLearningRecords(record, existing) : record,
      );
    });

    return Array.from(recordsByLesson.values());
  } catch {
    return [];
  }
}

export function mergeLearningRecords(
  local: LearningRecordRow,
  cloud?: CloudLearningRecord,
): LearningRecordRow {
  if (!cloud) return local;

  const localIsLatest =
    timestampValue(local.last_studied_at) >=
    timestampValue(cloud.last_studied_at);
  const latest = localIsLatest ? local : cloud;

  return {
    user_id: String(local.user_id),
    lesson_id: local.lesson_id,
    lesson_title:
      latest.lesson_title ?? local.lesson_title ?? cloud.lesson_title,
    status:
      local.status === "completed" || cloud.status === "completed"
        ? "completed"
        : "in-progress",
    last_studied_at: localIsLatest
      ? local.last_studied_at
      : cloud.last_studied_at,
    recitation_completed:
      local.recitation_completed || cloud.recitation_completed,
    proficiency: latest.proficiency,
    transcript_version:
      local.transcript_version ?? cloud.transcript_version ?? null,
  };
}

export async function hasCompletedLearningRecordsImport(userId: string) {
  const db = requireDatabase();
  const result = await db
    .from("user_sync_state")
    .select("learning_records_import_completed_at")
    .eq("user_id", String(userId))
    .maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data?.learning_records_import_completed_at);
}

export async function importLocalLearningRecords(
  userId: string,
  entries = readLocalLearningRecordsForSync(String(userId)),
) {
  const db = requireDatabase();
  const safeUserId = String(userId);
  const cloudResult = await db
    .from("learning_records")
    .select(
      "lesson_id,lesson_title,status,last_studied_at,recitation_completed,proficiency,transcript_version",
    )
    .eq("user_id", safeUserId);
  if (cloudResult.error) throw cloudResult.error;

  const cloudByLesson = new Map(
    ((cloudResult.data ?? []) as CloudLearningRecord[]).map((record) => [
      record.lesson_id,
      record,
    ]),
  );
  const mergedEntries = entries.map((entry) =>
    mergeLearningRecords(entry, cloudByLesson.get(entry.lesson_id)),
  );

  for (let index = 0; index < mergedEntries.length; index += uploadBatchSize) {
    const result = await db
      .from("learning_records")
      .upsert(mergedEntries.slice(index, index + uploadBatchSize), {
        onConflict: "user_id,lesson_id",
      });
    if (result.error) throw result.error;
  }

  const syncedAt = new Date().toISOString();
  const syncState = await db.from("user_sync_state").upsert(
    {
      user_id: safeUserId,
      schema_version: 1,
      learning_records_import_completed_at: syncedAt,
      last_sync_at: syncedAt,
    },
    { onConflict: "user_id" },
  );
  if (syncState.error) throw syncState.error;
  return mergedEntries.length;
}

export async function syncLearningRecord(
  userId: string,
  record: LocalLearningRecord,
) {
  const db = requireDatabase();
  const safeUserId = String(userId);
  const local = toLearningRecordRow(safeUserId, record);
  const cloudResult = await db
    .from("learning_records")
    .select(
      "lesson_id,lesson_title,status,last_studied_at,recitation_completed,proficiency,transcript_version",
    )
    .eq("user_id", safeUserId)
    .eq("lesson_id", record.lessonId)
    .maybeSingle();
  if (cloudResult.error) throw cloudResult.error;

  const merged = mergeLearningRecords(
    local,
    (cloudResult.data ?? undefined) as CloudLearningRecord | undefined,
  );
  const result = await db.from("learning_records").upsert(merged, {
    onConflict: "user_id,lesson_id",
  });
  if (result.error) throw result.error;
}

function toLearningRecordRow(
  userId: string,
  record: LocalLearningRecord,
): LearningRecordRow {
  return {
    user_id: String(userId),
    lesson_id: record.lessonId,
    lesson_title: record.lessonTitle || null,
    status: record.status,
    last_studied_at: normalizeTimestamp(record.lastStudiedAt),
    recitation_completed: record.recitationCompleted,
    proficiency: record.proficiency || null,
    transcript_version: getTranscriptVersion(record.lessonId),
  };
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function timestampValue(value: string | null) {
  return value ? Date.parse(value) || 0 : 0;
}

function requireDatabase() {
  if (!cloudbaseDb) throw new Error("CloudBase 数据库尚未配置。");
  return cloudbaseDb;
}
