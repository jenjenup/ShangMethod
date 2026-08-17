import lessonListData from "@/public/lessons/lessons.json";

type LessonTranscriptReference = {
  id: string;
  transcript: string;
};

const transcriptVersions = new Map(
  (lessonListData as LessonTranscriptReference[]).map((lesson) => [
    lesson.id,
    parseTranscriptVersion(lesson.transcript),
  ]),
);

export function getTranscriptVersion(lessonId: string): number | null {
  return transcriptVersions.get(lessonId) ?? null;
}

function parseTranscriptVersion(transcriptPath: string): number {
  const versionMatch = transcriptPath.match(/transcript-v(\d+)\.json$/i);
  if (!versionMatch) return 1;

  const version = Number(versionMatch[1]);
  return Number.isSafeInteger(version) && version >= 1 ? version : 1;
}
