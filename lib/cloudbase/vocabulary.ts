"use client";

import { cloudbaseDb } from "./client";

const vocabularyStorageKey = "shangmethod:vocabulary";
const uploadBatchSize = 200;
const vocabularyConflictColumns = "user_id,lesson_id,normalized_word";

export type LocalVocabularyEntry = {
  word: string;
  meaning: string;
  example: string;
  lessonId: string;
  lessonTitle: string;
  createdAt: string;
};

type StoredVocabularyEntry = {
  word?: unknown;
  meaning?: unknown;
  definition?: unknown;
  example?: unknown;
  exampleSentence?: unknown;
  lessonId?: unknown;
  lessonTitle?: unknown;
  createdAt?: unknown;
  addedAt?: unknown;
};

type VocabularyRow = {
  user_id: string;
  lesson_id: string;
  lesson_title: string | null;
  word: string;
  normalized_word: string;
  meaning: string | null;
  example: string | null;
  created_at: string;
};

export function normalizeWord(word: string) {
  return word
    .trim()
    .toLocaleLowerCase("en")
    .replace(/['’]/g, "");
}

export function readLocalVocabularyForSync(
  userId: string,
): VocabularyRow[] {
  const safeUserId = String(userId);

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(vocabularyStorageKey) ?? "[]",
    ) as unknown;

    if (!Array.isArray(stored)) return [];

    const entriesByKey = new Map<string, VocabularyRow>();

    stored.forEach((item: StoredVocabularyEntry) => {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.word !== "string" ||
        typeof item.lessonId !== "string"
      ) {
        return;
      }

      const word = item.word.trim();
      const lessonId = item.lessonId.trim();
      const normalizedWord = normalizeWord(word);
      if (!word || !lessonId || !normalizedWord) return;

      entriesByKey.set(`${lessonId}:${normalizedWord}`, {
        user_id: safeUserId,
        lesson_id: lessonId,
        lesson_title:
          typeof item.lessonTitle === "string" && item.lessonTitle.trim()
            ? item.lessonTitle.trim()
            : null,
        word,
        normalized_word: normalizedWord,
        meaning:
          typeof item.meaning === "string"
            ? item.meaning
            : typeof item.definition === "string"
              ? item.definition
              : null,
        example:
          typeof item.example === "string"
            ? item.example
            : typeof item.exampleSentence === "string"
              ? item.exampleSentence
              : null,
        created_at: normalizeTimestamp(item.createdAt ?? item.addedAt),
      });
    });

    return Array.from(entriesByKey.values());
  } catch {
    return [];
  }
}

export async function hasCompletedVocabularyImport(userId: string) {
  const db = requireDatabase();
  const result = await db
    .from("user_sync_state")
    .select("local_import_completed_at")
    .eq("user_id", String(userId))
    .maybeSingle();

  if (result.error) throw result.error;
  return Boolean(result.data?.local_import_completed_at);
}

export async function importLocalVocabulary(
  userId: string,
  entries = readLocalVocabularyForSync(String(userId)),
) {
  const db = requireDatabase();
  const safeUserId = String(userId);

  for (let index = 0; index < entries.length; index += uploadBatchSize) {
    const result = await db
      .from("vocabulary_entries")
      .upsert(entries.slice(index, index + uploadBatchSize), {
        onConflict: vocabularyConflictColumns,
      });
    if (result.error) throw result.error;
  }

  const syncedAt = new Date().toISOString();
  const syncState = await db.from("user_sync_state").upsert(
    {
      user_id: safeUserId,
      schema_version: 1,
      local_import_completed_at: syncedAt,
      last_sync_at: syncedAt,
    },
    { onConflict: "user_id" },
  );
  if (syncState.error) throw syncState.error;
}

export async function syncVocabularyEntry(
  userId: string,
  entry: LocalVocabularyEntry,
) {
  const db = requireDatabase();
  const row = toVocabularyRow(String(userId), entry);
  const result = await db.from("vocabulary_entries").upsert(row, {
    onConflict: vocabularyConflictColumns,
  });
  if (result.error) throw result.error;
}

export async function deleteVocabularyEntry(
  userId: string,
  entry: Pick<LocalVocabularyEntry, "lessonId" | "word">,
) {
  const db = requireDatabase();
  const result = await db
    .from("vocabulary_entries")
    .delete()
    .eq("user_id", String(userId))
    .eq("lesson_id", entry.lessonId)
    .eq("normalized_word", normalizeWord(entry.word));
  if (result.error) throw result.error;
}

function toVocabularyRow(
  userId: string,
  entry: LocalVocabularyEntry,
): VocabularyRow {
  return {
    user_id: String(userId),
    lesson_id: entry.lessonId,
    lesson_title: entry.lessonTitle || null,
    word: entry.word.trim(),
    normalized_word: normalizeWord(entry.word),
    meaning: entry.meaning || null,
    example: entry.example || null,
    created_at: normalizeTimestamp(entry.createdAt),
  };
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
}

function requireDatabase() {
  if (!cloudbaseDb) {
    throw new Error("CloudBase 数据库尚未配置。");
  }
  return cloudbaseDb;
}
