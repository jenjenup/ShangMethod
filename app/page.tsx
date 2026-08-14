"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { AuthStatus } from "@/components/auth/auth-status";
import { useAuth } from "@/components/auth/auth-provider";
import {
  deleteVocabularyEntry,
  syncVocabularyEntry,
} from "@/lib/cloudbase/vocabulary";
import { syncLearningRecord } from "@/lib/cloudbase/learning-records";
import { scheduleDictationDraftSync } from "@/lib/cloudbase/dictation-drafts";
import lessonListData from "@/public/lessons/lessons.json";

type Duration = "10分钟内" | "10-20分钟" | "20-30分钟" | "30分钟以上";

type Segment = {
  id: number;
  start: number;
  end: number;
  text: string;
};

type Material = {
  id: string;
  title: string;
  duration: Duration;
  description: string;
  audio?: string;
  segments?: Segment[];
  translation?: string;
};

type LessonListEntry = {
  id: string;
  title: string;
  durationCategory: Duration;
  summary: string;
  audio: string;
  transcript: string;
};

type LessonTranscript = {
  id: string;
  title: string;
  durationSeconds: number;
  durationCategory: Duration;
  summary: string;
  audio: string;
  translation: string;
  sentences: Array<{
    id: number;
    start: number;
    end: number;
    english: string;
    chinese: string;
  }>;
};

type VocabularyEntry = {
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

type LearningRecord = {
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

const vocabularyStorageKey = "shangmethod:vocabulary";
const learningRecordsStorageKey = "shangmethod:learning-records";
let dictionaryPromise: Promise<Record<string, string>> | null = null;

function loadDictionary() {
  if (!dictionaryPromise) {
    dictionaryPromise = fetch("/dictionary.json").then(async (response) => {
      if (!response.ok) {
        throw new Error("Unable to load dictionary");
      }

      const dictionary = await response.json() as unknown;
      if (!dictionary || typeof dictionary !== "object") {
        throw new Error("Invalid dictionary data");
      }

      return Object.fromEntries(
        Object.entries(dictionary).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string",
        ),
      );
    });
  }

  return dictionaryPromise;
}

function readVocabulary(): VocabularyEntry[] {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(vocabularyStorageKey) ?? "[]",
    ) as unknown;

    if (!Array.isArray(stored)) return [];

    return stored.flatMap((item: StoredVocabularyEntry) => {
      if (!item || typeof item !== "object" || typeof item.word !== "string") {
        return [];
      }

      const word = item.word.trim();
      if (!word) return [];

      return [{
        word,
        meaning:
          typeof item.meaning === "string"
            ? item.meaning
            : typeof item.definition === "string"
              ? item.definition
              : "暂无释义",
        example:
          typeof item.example === "string"
            ? item.example
            : typeof item.exampleSentence === "string"
              ? item.exampleSentence
              : "",
        lessonId: typeof item.lessonId === "string" ? item.lessonId : "",
        lessonTitle:
          typeof item.lessonTitle === "string" ? item.lessonTitle : "未知课程",
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : typeof item.addedAt === "string"
              ? item.addedAt
              : "",
      }];
    });
  } catch {
    return [];
  }
}

function readLearningRecords(): LearningRecord[] {
  let records: LearningRecord[] = [];

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(learningRecordsStorageKey) ?? "[]",
    ) as unknown;

    if (Array.isArray(stored)) {
      records = stored.flatMap((item: StoredLearningRecord) => {
        if (
          !item ||
          typeof item !== "object" ||
          typeof item.lessonId !== "string"
        ) {
          return [];
        }

        return [{
          lessonId: item.lessonId,
          lessonTitle:
            typeof item.lessonTitle === "string"
              ? item.lessonTitle
              : item.lessonId,
          status: item.status === "completed" ? "completed" : "in-progress",
          lastStudiedAt:
            typeof item.lastStudiedAt === "string" ? item.lastStudiedAt : "",
          recitationCompleted: item.recitationCompleted === true,
          proficiency:
            typeof item.proficiency === "string" ? item.proficiency : "",
        }];
      });
    }
  } catch {
    records = [];
  }

  const recordsByLesson = new Map(
    records.map((record) => [record.lessonId, record]),
  );
  const vocabulary = readVocabulary();

  materials.forEach((material) => {
    if (recordsByLesson.has(material.id)) return;

    let hasDictation = false;
    try {
      hasDictation =
        window.localStorage.getItem(`shangmethod:dictation:${material.id}`) !==
        null;
    } catch {
      hasDictation = false;
    }

    const lessonVocabulary = vocabulary.filter(
      (entry) => entry.lessonId === material.id,
    );
    if (!hasDictation && lessonVocabulary.length === 0) return;

    const latestVocabularyDate = lessonVocabulary
      .map((entry) => entry.createdAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? "";

    recordsByLesson.set(material.id, {
      lessonId: material.id,
      lessonTitle: material.title,
      status: "in-progress",
      lastStudiedAt: latestVocabularyDate,
      recitationCompleted: false,
      proficiency: "",
    });
  });

  vocabulary.forEach((entry) => {
    if (!entry.lessonId || recordsByLesson.has(entry.lessonId)) return;
    recordsByLesson.set(entry.lessonId, {
      lessonId: entry.lessonId,
      lessonTitle: entry.lessonTitle,
      status: "in-progress",
      lastStudiedAt: entry.createdAt,
      recitationCompleted: false,
      proficiency: "",
    });
  });

  return Array.from(recordsByLesson.values()).sort((a, b) =>
    b.lastStudiedAt.localeCompare(a.lastStudiedAt),
  );
}

function saveLearningRecord(
  material: Material,
  updates: Partial<Pick<LearningRecord, "status" | "recitationCompleted" | "proficiency">> = {},
) {
  try {
    const currentRecords = readLearningRecords();
    const existingRecord = currentRecords.find(
      (record) => record.lessonId === material.id,
    );
    const nextRecord: LearningRecord = {
      lessonId: material.id,
      lessonTitle: material.title,
      status: updates.status ?? existingRecord?.status ?? "in-progress",
      lastStudiedAt: new Date().toISOString(),
      recitationCompleted:
        updates.recitationCompleted ??
        existingRecord?.recitationCompleted ??
        false,
      proficiency: updates.proficiency ?? existingRecord?.proficiency ?? "",
    };
    const nextRecords = currentRecords.filter(
      (record) => record.lessonId !== material.id,
    );
    nextRecords.unshift(nextRecord);
    window.localStorage.setItem(
      learningRecordsStorageKey,
      JSON.stringify(nextRecords),
    );
    return nextRecord;
  } catch {
    // Learning remains available if browser storage is unavailable.
    return null;
  }
}

function formatStudiedAt(value: string) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function speakWord(word: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

const audioBaseUrl = (process.env.NEXT_PUBLIC_AUDIO_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

function resolveAudioUrl(audioUrl: string) {
  if (!audioBaseUrl || /^(?:https?:)?\/\//i.test(audioUrl)) {
    return audioUrl;
  }

  return `${audioBaseUrl}/${audioUrl.replace(/^\/+/, "")}`;
}

const lessonList = lessonListData as LessonListEntry[];
const materials: Material[] = lessonList.map((lesson) => ({
  id: lesson.id,
  title: lesson.title,
  duration: lesson.durationCategory,
  description: lesson.summary,
  audio: resolveAudioUrl(lesson.audio),
}));
const loadedMaterials = new Map<string, Material>();

async function loadMaterial(materialId: string) {
  const cachedMaterial = loadedMaterials.get(materialId);
  if (cachedMaterial) return cachedMaterial;

  const lesson = lessonList.find((item) => item.id === materialId);
  if (!lesson) return null;

  const response = await fetch(lesson.transcript);
  if (!response.ok) {
    throw new Error(`Unable to load transcript for ${materialId}`);
  }

  const transcript = await response.json() as LessonTranscript;
  const material: Material = {
    id: transcript.id,
    title: transcript.title,
    duration: transcript.durationCategory,
    description: transcript.summary,
    audio: resolveAudioUrl(transcript.audio),
    segments: transcript.sentences.map((sentence) => ({
      id: sentence.id,
      start: sentence.start,
      end: sentence.end,
      text: sentence.english,
    })),
    translation: transcript.translation,
  };

  loadedMaterials.set(materialId, material);
  return material;
}

const steps = ["选择材料", "反复听写", "对照精学", "熟练背诵"];
const playbackRates = [0.75, 1, 1.25, 1.5] as const;

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function Header({
  onStart,
  onReview,
  onHistory,
  activePage = "learning",
}: {
  onStart: () => void;
  onReview: () => void;
  onHistory: () => void;
  activePage?: "learning" | "review" | "history";
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <span className="brand-mark">EL</span>
          <span>ShangMethod</span>
        </button>
        <nav aria-label="主要导航">
          <button
            className={activePage === "learning" ? "nav-link nav-link-active" : "nav-link"}
            type="button"
            onClick={onStart}
          >
            开始学习
          </button>
          <button
            className={activePage === "review" ? "nav-link nav-link-active" : "nav-link"}
            type="button"
            onClick={onReview}
          >
            复习中心
          </button>
          <button
            className={
              activePage === "history"
                ? "nav-link nav-link-active nav-link-history"
                : "nav-link nav-link-history"
            }
            type="button"
            onClick={onHistory}
          >
            学习记录
          </button>
          <AuthStatus />
        </nav>
      </div>
    </header>
  );
}

function ProgressSteps({ activeStep = 0 }: { activeStep?: number }) {
  return (
    <ol className="progress-list" aria-label="学习流程">
      {steps.map((step, index) => (
        <li className={index === activeStep ? "progress-item is-active" : "progress-item"} key={step}>
          <span className="step-number">{index + 1}</span>
          <span className="step-name">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="filter-group">
      <p>{label}</p>
      <div className="filter-options">
        {options.map((option) => (
          <button
            type="button"
            className={selected === option ? "filter-button is-selected" : "filter-button"}
            aria-pressed={selected === option}
            onClick={() => onSelect(option)}
            key={option}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function MaterialCard({
  material,
  onChoose,
}: {
  material: Material;
  onChoose: (material: Material) => void;
}) {
  return (
    <article className="material-card">
      <div className="material-meta">
        <span>{material.duration}</span>
      </div>
      <h3>{material.title}</h3>
      <p>{material.description}</p>
      <button className="card-button" type="button" onClick={() => onChoose(material)}>
        采用这篇
        <span aria-hidden="true">→</span>
      </button>
    </article>
  );
}

type AudioPlayerHandle = {
  playSegment: (start: number, end: number) => Promise<void>;
  stopSegment: () => void;
};

type AudioPlayerProps = {
  src: string;
  autoScroll?: boolean;
  onSegmentEnd?: () => void;
  onDurationReady?: (duration: number) => void;
};

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer(
    { src, autoScroll = false, onSegmentEnd, onDurationReady },
    ref,
  ) {
  const playerRef = useRef<HTMLElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentEndRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    if (autoScroll) {
      playerRef.current?.scrollIntoView({ block: "start" });
    }
  }, [autoScroll]);

  useImperativeHandle(ref, () => ({
    async playSegment(start: number, end: number) {
      const audio = audioRef.current;
      if (!audio) return;

      segmentEndRef.current = end;
      audio.currentTime = start;
      setCurrentTime(start);

      try {
        await audio.play();
      } catch {
        segmentEndRef.current = null;
        setIsPlaying(false);
        onSegmentEnd?.();
      }
    },
    stopSegment() {
      const audio = audioRef.current;
      if (!audio) return;

      segmentEndRef.current = null;
      audio.pause();
      onSegmentEnd?.();
    },
  }));

  const handleTimeUpdate = (audio: HTMLAudioElement) => {
    setCurrentTime(audio.currentTime);

    const segmentEnd = segmentEndRef.current;
    if (segmentEnd !== null && audio.currentTime >= segmentEnd) {
      segmentEndRef.current = null;
      audio.pause();
      audio.currentTime = segmentEnd;
      setCurrentTime(segmentEnd);
      onSegmentEnd?.();
    }
  };

  const handlePause = () => {
    setIsPlaying(false);

    if (segmentEndRef.current !== null) {
      segmentEndRef.current = null;
      onSegmentEnd?.();
    }
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
    }
  };

  const seekTo = (time: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.currentTime = Math.min(Math.max(time, 0), totalTime || 0);
    setCurrentTime(audio.currentTime);
  };

  const changePlaybackRate = (rate: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.playbackRate = rate;
    setPlaybackRate(rate);
  };

  return (
    <section ref={playerRef} className="audio-player" aria-label="课程音频播放器">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          setTotalTime(event.currentTarget.duration);
          onDurationReady?.(event.currentTarget.duration);
        }}
        onDurationChange={(event) => {
          setTotalTime(event.currentTarget.duration);
          onDurationReady?.(event.currentTarget.duration);
        }}
        onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)}
        onPlay={() => setIsPlaying(true)}
        onPause={handlePause}
        onEnded={() => {
          segmentEndRef.current = null;
          setIsPlaying(false);
          onSegmentEnd?.();
        }}
      />

      <div className="player-heading">
        <div>
          <p className="chosen-label">课程音频</p>
          <strong>先完整听一遍，熟悉声音与节奏</strong>
        </div>
        <span>{playbackRate}x</span>
      </div>

      <div className="player-timeline">
        <span>{formatTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={totalTime || 1}
          step="0.1"
          value={currentTime}
          onChange={(event) => seekTo(Number(event.target.value))}
          aria-label="播放进度"
        />
        <span>{formatTime(totalTime)}</span>
      </div>

      <div className="player-controls">
        <button
          type="button"
          className="skip-button"
          onClick={() => seekTo(currentTime - 5)}
          aria-label="后退5秒"
        >
          −5s
        </button>
        <button
          type="button"
          className="play-button"
          onClick={togglePlayback}
          aria-label={isPlaying ? "暂停" : "播放"}
        >
          <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
          {isPlaying ? "暂停" : "播放"}
        </button>
        <button
          type="button"
          className="skip-button"
          onClick={() => seekTo(currentTime + 5)}
          aria-label="前进5秒"
        >
          +5s
        </button>
      </div>

      <div className="speed-controls" aria-label="播放速度">
        <span>播放速度</span>
        <div>
          {playbackRates.map((rate) => (
            <button
              type="button"
              className={playbackRate === rate ? "speed-button is-active" : "speed-button"}
              aria-pressed={playbackRate === rate}
              onClick={() => changePlaybackRate(rate)}
              key={rate}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>
    </section>
  );
});

function DictationWorkspace({
  lessonId,
  audio,
  onCompare,
}: {
  lessonId: string;
  audio?: string;
  onCompare: () => void;
}) {
  const { user } = useAuth();
  const storageKey = `shangmethod:dictation:${lessonId}`;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    try {
      setDraft(window.localStorage.getItem(storageKey) ?? "");
    } catch {
      setDraft("");
    }
  }, [storageKey]);

  const updateDraft = (value: string) => {
    setDraft(value);

    try {
      window.localStorage.setItem(storageKey, value);
      if (user) {
        scheduleDictationDraftSync(String(user.id), lessonId, value);
      }
    } catch {
      // The current draft remains usable even when browser storage is unavailable.
    }
  };

  const markUnclear = () => {
    const input = inputRef.current;
    const selectionStart = input?.selectionStart ?? draft.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    const marker = "[?]";
    const nextDraft =
      draft.slice(0, selectionStart) + marker + draft.slice(selectionEnd);
    const nextCursorPosition = selectionStart + marker.length;

    updateDraft(nextDraft);
    window.requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  return (
    <section className="dictation-workspace" aria-labelledby="dictation-title">
      <div className="dictation-heading">
        <p className="eyebrow">第二步 · 听写训练</p>
        <h1 id="dictation-title">反复听写</h1>
        <p>
          反复播放音频，把你听到的英文尽可能完整地写下来。
          <br />
          确保已尽力“啃”完，再进入“对照精学”。
        </p>
      </div>
      {audio && (
        <div className="dictation-audio-assist">
          <strong>材料音频</strong>
          <AudioPlayer src={audio} />
        </div>
      )}
      <div className="dictation-input-heading">
        <label htmlFor="dictation-input">听写内容</label>
        <button type="button" className="unclear-button" onClick={markUnclear}>
          标记听不清
          <span aria-hidden="true">[?]</span>
        </button>
      </div>
      <textarea
        ref={inputRef}
        id="dictation-input"
        value={draft}
        onChange={(event) => updateDraft(event.target.value)}
        placeholder="在这里输入你听到的内容……"
        aria-describedby="dictation-hint"
      />
      <div className="dictation-footer">
        <p id="dictation-hint">内容会自动保存在当前浏览器中。</p>
        <button type="button" className="compare-button" onClick={onCompare}>
          进入对照精学
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

function DictationView({
  material,
  onBack,
  onCompare,
}: {
  material: Material;
  onBack: () => void;
  onCompare: () => void;
}) {
  return (
    <main className="dictation-page">
      <div className="preparation-shell">
        <button type="button" className="back-button" onClick={onBack}>
          <span aria-hidden="true">←</span> 返回选择材料
        </button>

        <section className="dictation-progress" aria-label="学习进度">
          <ProgressSteps activeStep={1} />
        </section>

        <DictationWorkspace
          lessonId={material.id}
          audio={material.audio}
          onCompare={onCompare}
        />
      </div>
    </main>
  );
}

function tokenizeForComparison(value: string) {
  return (
    value.match(
      /\[\?\]|[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*|\s+|[^\sA-Za-z0-9]+/g,
    ) ?? []
  );
}

function normalizeComparisonToken(token: string) {
  if (token === "[?]") return token;

  return token
    .replace(/[.,?!"'():;‘’“”]/g, "")
    .toLocaleLowerCase("en");
}

function getUserSentenceDiff(standard: string, user: string) {
  const standardWords = tokenizeForComparison(standard)
    .map(normalizeComparisonToken)
    .filter(Boolean);
  const userParts = tokenizeForComparison(user);
  const userWords = userParts
    .map((token, partIndex) => ({
      normalized: normalizeComparisonToken(token),
      partIndex,
    }))
    .filter(({ normalized }) => Boolean(normalized));
  const matchedUserParts = new Set<number>();
  const matrix = Array.from({ length: standardWords.length + 1 }, () =>
    Array<number>(userWords.length + 1).fill(0),
  );

  for (let standardIndex = standardWords.length - 1; standardIndex >= 0; standardIndex -= 1) {
    for (let userIndex = userWords.length - 1; userIndex >= 0; userIndex -= 1) {
      matrix[standardIndex][userIndex] =
        standardWords[standardIndex] === userWords[userIndex].normalized &&
        userWords[userIndex].normalized !== "[?]"
          ? matrix[standardIndex + 1][userIndex + 1] + 1
          : Math.max(
              matrix[standardIndex + 1][userIndex],
              matrix[standardIndex][userIndex + 1],
            );
    }
  }

  let standardIndex = 0;
  let userIndex = 0;

  while (
    standardIndex < standardWords.length &&
    userIndex < userWords.length
  ) {
    const userWord = userWords[userIndex];

    if (
      standardWords[standardIndex] === userWord.normalized &&
      userWord.normalized !== "[?]"
    ) {
      matchedUserParts.add(userWord.partIndex);
      standardIndex += 1;
      userIndex += 1;
    } else if (
      matrix[standardIndex + 1][userIndex] >=
      matrix[standardIndex][userIndex + 1]
    ) {
      standardIndex += 1;
    } else {
      userIndex += 1;
    }
  }

  const comparableUserParts = new Set(
    userWords.map(({ partIndex }) => partIndex),
  );

  return userParts.map((text, partIndex) => ({
    text,
    isError:
      comparableUserParts.has(partIndex) && !matchedUserParts.has(partIndex),
  }));
}

function splitDictationForEditing(value: string) {
  if (!value) return [];

  if (value.includes("\n")) {
    let segmentIndex = 0;

    return value.split(/(\n)/).map((text) => {
      if (text === "\n") {
        return { text, segmentIndex: null };
      }

      const chunk = { text, segmentIndex };
      segmentIndex += 1;
      return chunk;
    });
  }

  return (value.match(/.*?[.!?](?:\s+|$)|.+$/g) ?? []).map(
    (text, segmentIndex) => ({ text, segmentIndex }),
  );
}

function EditableDiffInput({
  value,
  segments,
  activeSegmentId,
  onChange,
}: {
  value: string;
  segments: Segment[];
  activeSegmentId: number | null;
  onChange: (value: string) => void;
}) {
  const highlightRef = useRef<HTMLDivElement>(null);
  const chunks = splitDictationForEditing(value);

  const syncScroll = (input: HTMLTextAreaElement) => {
    if (!highlightRef.current) return;

    highlightRef.current.scrollTop = input.scrollTop;
    highlightRef.current.scrollLeft = input.scrollLeft;
  };

  return (
    <div className="editable-diff">
      <div
        ref={highlightRef}
        className="editable-diff-layer"
        aria-hidden="true"
      >
        {chunks.map((chunk, chunkIndex) => {
          if (chunk.segmentIndex === null) {
            return chunk.text;
          }

          const segment = segments[chunk.segmentIndex];
          const diffParts = getUserSentenceDiff(segment?.text ?? "", chunk.text);

          return (
            <span
              className={
                segment && activeSegmentId === segment.id
                  ? "reading-sentence is-active"
                  : "reading-sentence"
              }
              key={`${chunk.segmentIndex}-${chunkIndex}`}
            >
              {diffParts.map((part, partIndex) => (
                <span
                  className={part.isError ? "diff-error" : undefined}
                  key={`${chunkIndex}-${partIndex}`}
                >
                  {part.text}
                </span>
              ))}
            </span>
          );
        })}
        {value.endsWith("\n") ? " " : null}
      </div>
      <textarea
        className="editable-diff-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => syncScroll(event.currentTarget)}
        aria-label="我的听写"
        placeholder="在这里修改你的听写内容……"
        spellCheck={false}
      />
    </div>
  );
}

function ComparisonView({
  material,
  onBack,
  onComplete,
}: {
  material: Material;
  onBack: () => void;
  onComplete: () => void;
}) {
  const { user } = useAuth();
  const playerRef = useRef<AudioPlayerHandle>(null);
  const [dictation, setDictation] = useState("");
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  const [lookup, setLookup] = useState<{
    key: string;
    word: string;
    definition: string;
    sentence: string;
    top: number;
    left: number;
  } | null>(null);
  const [savedVocabularyKeys, setSavedVocabularyKeys] = useState<Set<string>>(
    new Set(),
  );
  const segments = material.segments ?? [];

  useEffect(() => {
    try {
      setDictation(
        window.localStorage.getItem(`shangmethod:dictation:${material.id}`) ?? "",
      );
    } catch {
      setDictation("");
    }
  }, [material.id]);

  useEffect(() => {
    if (!lookup) return;

    const closeLookup = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".dictionary-tooltip, .word-lookup-button")
      ) {
        return;
      }

      setLookup(null);
    };
    document.addEventListener("click", closeLookup);
    return () => document.removeEventListener("click", closeLookup);
  }, [lookup]);

  useEffect(() => {
    try {
      const savedVocabulary = JSON.parse(
        window.localStorage.getItem(vocabularyStorageKey) ?? "[]",
      ) as Array<{ word?: string; lessonId?: string }>;
      setSavedVocabularyKeys(
        new Set(
          savedVocabulary
            .filter((item) => item.word && item.lessonId)
            .map(
              (item) =>
                `${item.lessonId}:${item.word?.toLocaleLowerCase("en")}`,
            ),
        ),
      );
    } catch {
      setSavedVocabularyKeys(new Set());
    }
  }, []);

  const updateDictation = (value: string) => {
    setDictation(value);

    try {
      window.localStorage.setItem(
        `shangmethod:dictation:${material.id}`,
        value,
      );
      if (user) {
        scheduleDictationDraftSync(String(user.id), material.id, value);
      }
    } catch {
      // Editing remains available when browser storage is unavailable.
    }
  };

  const playSegment = (segment: Segment) => {
    if (!material.audio) return;

    if (activeSegmentId === segment.id) {
      playerRef.current?.stopSegment();
      return;
    }

    setActiveSegmentId(segment.id);
    void playerRef.current?.playSegment(segment.start, segment.end);
  };

  const openLookup = async (
    event: ReactMouseEvent<HTMLButtonElement>,
    word: string,
    key: string,
    sentence: string,
  ) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const dictionaryKey = word
      .toLocaleLowerCase("en")
      .replace(/['’]/g, "");
    const tooltipWidth = 232;
    let dictionary: Record<string, string> = {};

    try {
      dictionary = await loadDictionary();
    } catch {
      // Lookup remains available with the existing fallback message.
    }

    setLookup({
      key,
      word: word.toLocaleLowerCase("en"),
      definition: dictionary[dictionaryKey] ?? "暂无中文释义",
      sentence,
      top: rect.bottom + 10,
      left: Math.min(
        Math.max(rect.left + rect.width / 2 - tooltipWidth / 2, 12),
        window.innerWidth - tooltipWidth - 12,
      ),
    });
  };

  const addLookupToVocabulary = () => {
    if (!lookup) return;

    const savedKey = `${material.id}:${lookup.word}`;

    try {
      const currentVocabulary = readVocabulary();
      const nextEntry = {
        word: lookup.word,
        meaning: lookup.definition,
        example: lookup.sentence,
        lessonId: material.id,
        lessonTitle: material.title,
        createdAt: new Date().toISOString(),
      };
      const existingIndex = currentVocabulary.findIndex(
        (item) =>
          item.lessonId === material.id &&
          item.word.toLocaleLowerCase("en") === lookup.word,
      );
      const nextVocabulary = [...currentVocabulary];

      if (existingIndex >= 0) {
        nextVocabulary[existingIndex] = nextEntry;
      } else {
        nextVocabulary.push(nextEntry);
      }

      window.localStorage.setItem(
        vocabularyStorageKey,
        JSON.stringify(nextVocabulary),
      );
      if (user) {
        void syncVocabularyEntry(String(user.id), nextEntry).catch(() => {
          // Local vocabulary remains the immediate source if cloud sync fails.
        });
      }
      setSavedVocabularyKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);
        nextKeys.add(savedKey);
        return nextKeys;
      });
    } catch {
      // The dictionary remains usable if browser storage is unavailable.
    }
  };

  const pronounceWord = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!lookup || !("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(lookup.word);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  };

  return (
    <main className="dictation-page">
      <div className="preparation-shell">
        <button type="button" className="back-button" onClick={onBack}>
          <span aria-hidden="true">←</span> 返回反复听写
        </button>

        <section className="dictation-progress" aria-label="学习进度">
          <ProgressSteps activeStep={2} />
        </section>

        {material.audio && (
          <div className="comparison-segment-player" aria-hidden="true">
            <AudioPlayer
              ref={playerRef}
              src={material.audio}
              onSegmentEnd={() => setActiveSegmentId(null)}
            />
          </div>
        )}

        <div className="comparison-heading">
          <p className="eyebrow">第三步 · 对照精学</p>
          <h1>对照精学</h1>
          <p>对照你的听写与标准内容，找出还没有真正听懂的部分，进行学习。</p>
        </div>

        <div className="comparison-sections">
          <section className="comparison-section" aria-labelledby="original-title">
            <p className="comparison-label">标准内容</p>
            <h2 id="original-title">标准原文</h2>
            <p className="reading-text reading-original">
              {segments.map((segment, index) => (
                <span
                  className="reading-sentence-wrap"
                  key={segment.id}
                >
                  <button
                    type="button"
                    className="sentence-audio-button"
                    aria-label={`${
                      activeSegmentId === segment.id ? "停止" : "播放"
                    }标准原文第${index + 1}句`}
                    aria-pressed={activeSegmentId === segment.id}
                    onClick={() => playSegment(segment)}
                  >
                    <span aria-hidden="true">🔊</span>
                  </button>{" "}
                  <span
                    className={
                      activeSegmentId === segment.id
                        ? "reading-sentence is-active"
                        : "reading-sentence"
                    }
                  >
                    {tokenizeForComparison(segment.text).map(
                      (token, tokenIndex) => {
                        const isEnglishWord =
                          /^[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*$/.test(token);
                        const tokenKey = `${segment.id}-${tokenIndex}`;

                        if (isEnglishWord) {
                          return (
                            <button
                              type="button"
                              className="word-lookup-button"
                              aria-label={`查看 ${token} 的中文释义`}
                              aria-expanded={lookup?.key === tokenKey}
                              onClick={(event) =>
                                void openLookup(
                                  event,
                                  token,
                                  tokenKey,
                                  segment.text,
                                )
                              }
                              key={tokenKey}
                            >
                              {token}
                            </button>
                          );
                        }

                        return (
                          <span key={tokenKey}>{token}</span>
                        );
                      },
                    )}
                  </span>{" "}
                </span>
              ))}
            </p>
          </section>

          <section className="comparison-section" aria-labelledby="dictation-result-title">
            <p className="comparison-label">你的记录</p>
            <h2 id="dictation-result-title">我的听写</h2>
            <EditableDiffInput
              value={dictation}
              segments={segments}
              activeSegmentId={activeSegmentId}
              onChange={updateDictation}
            />
          </section>

          <section
            className="comparison-section comparison-translation"
            aria-labelledby="translation-title"
          >
            <p className="comparison-label">理解参考</p>
            <h2 id="translation-title">中文翻译</h2>
            <p className="comparison-text">
              {material.translation || "本课程暂未提供完整中文翻译。"}
            </p>
          </section>
        </div>

        <div className="comparison-complete">
          <button type="button" className="compare-button" onClick={onComplete}>
            完成听写，进入熟练背诵
            <span aria-hidden="true">→</span>
          </button>
        </div>

        {lookup && (
          <div
            className="dictionary-tooltip"
            style={{ top: lookup.top, left: lookup.left }}
            role="tooltip"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dictionary-tooltip-heading">
              <strong>{lookup.word}</strong>
              <button
                type="button"
                className="dictionary-pronunciation-button"
                aria-label={`播放 ${lookup.word} 的英文发音`}
                title="播放英文发音"
                onClick={pronounceWord}
              >
                <span aria-hidden="true">🔊</span>
              </button>
            </div>
            <span>{lookup.definition}</span>
            <button
              type="button"
              className="dictionary-save-button"
              disabled={savedVocabularyKeys.has(
                `${material.id}:${lookup.word}`,
              )}
              onClick={addLookupToVocabulary}
            >
              {savedVocabularyKeys.has(`${material.id}:${lookup.word}`)
                ? "已加入生词本"
                : "加入生词本"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function RecitationView({
  material,
  onBack,
  onRecordingComplete,
}: {
  material: Material;
  onBack: () => void;
  onRecordingComplete?: (proficiency: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOriginalVisible, setIsOriginalVisible] = useState(true);
  const [originalDuration, setOriginalDuration] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [isRecordingPlaybackActive, setIsRecordingPlaybackActive] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedDuration, setRecordedDuration] = useState<number | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingAudioRef = useRef<HTMLAudioElement>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const recordingPausedAtRef = useRef(0);
  const totalRecordingPausedRef = useRef(0);
  const recordingTimerRef = useRef<number | null>(null);
  const segments = material.segments ?? [];

  useEffect(() => {
    window.requestAnimationFrame(() => {
      contentRef.current?.scrollIntoView({ block: "start" });
    });
  }, []);

  const clearRecordingTimer = () => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const getActiveRecordingDuration = () =>
    Math.max(
      (performance.now() -
        recordingStartedAtRef.current -
        totalRecordingPausedRef.current) /
        1000,
      0,
    );

  const stopMediaStream = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  useEffect(() => {
    return () => {
      clearRecordingTimer();
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording" || recorder?.state === "paused") {
        recorder.stop();
      }
      stopMediaStream();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
      }
    };
  }, [recordingUrl]);

  const startRecording = async () => {
    setRecordingError("");
    recordingAudioRef.current?.pause();

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecordingError("当前浏览器不支持录音，请更换支持录音的浏览器。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      setRecordedDuration(null);
      setRecordingTime(0);
      setIsRecording(true);
      setIsRecordingPaused(false);
      setIsRecordingPlaybackActive(false);
      recordingStartedAtRef.current = performance.now();
      recordingPausedAtRef.current = 0;
      totalRecordingPausedRef.current = 0;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener(
        "stop",
        () => {
          clearRecordingTimer();
          const duration = getActiveRecordingDuration();
          const blob = new Blob(recordingChunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });

          setRecordingTime(duration);
          setRecordedDuration(duration);
          setRecordingUrl((currentUrl) => {
            if (currentUrl) URL.revokeObjectURL(currentUrl);
            return URL.createObjectURL(blob);
          });
          setIsRecording(false);
          setIsRecordingPaused(false);
          stopMediaStream();
          const difference = Math.abs(duration - originalDuration);
          const proficiency =
            originalDuration <= 0
              ? "已完成"
              : difference <= 5
                ? "优秀"
                : difference <= 10
                  ? "基本掌握"
                  : "需要继续熟练";
          onRecordingComplete?.(proficiency);
        },
        { once: true },
      );

      recorder.start();
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingTime(getActiveRecordingDuration());
      }, 100);
    } catch {
      clearRecordingTimer();
      stopMediaStream();
      setIsRecording(false);
      setRecordingError("无法使用麦克风，请允许浏览器访问麦克风后重试。");
    }
  };

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state !== "recording") return;

    recorder.pause();
    recordingPausedAtRef.current = performance.now();
    clearRecordingTimer();
    setRecordingTime(getActiveRecordingDuration());
    setIsRecordingPaused(true);
  };

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state !== "paused") return;

    totalRecordingPausedRef.current +=
      performance.now() - recordingPausedAtRef.current;
    recorder.resume();
    setIsRecordingPaused(false);
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingTime(getActiveRecordingDuration());
    }, 100);
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "paused") {
      totalRecordingPausedRef.current +=
        performance.now() - recordingPausedAtRef.current;
    }
    if (recorder?.state === "recording" || recorder?.state === "paused") {
      recorder.stop();
    }
  };

  const toggleRecordingPlayback = async () => {
    const audio = recordingAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setIsRecordingPlaybackActive(false);
      }
    } else {
      audio.pause();
    }
  };

  const speedDifference =
    recordedDuration !== null && originalDuration > 0
      ? Math.abs(recordedDuration - originalDuration)
      : null;
  const speedFeedback =
    speedDifference === null
      ? null
      : speedDifference <= 5
        ? {
            level: "优秀",
            message: "已接近原音节奏",
            className: "is-excellent",
          }
        : speedDifference <= 10
          ? {
              level: "基本掌握",
              message: "可以继续优化",
              className: "is-good",
            }
          : {
              level: "需要继续熟练",
              message: "建议继续练习",
              className: "is-practice",
            };

  return (
    <main className="dictation-page">
      <div className="preparation-shell">
        <button type="button" className="back-button" onClick={onBack}>
          <span aria-hidden="true">←</span> 返回对照精学
        </button>

        <section className="dictation-progress" aria-label="学习进度">
          <ProgressSteps activeStep={3} />
        </section>

        <div
          ref={contentRef}
          className="comparison-heading recitation-heading"
        >
          <p className="eyebrow">第四步 · 熟练背诵</p>
          <h1>熟练背诵</h1>
          <p>先熟悉原文，再隐藏原文脱稿背诵，最后用录音检验背诵节奏。</p>
        </div>

        <section className="recitation-section" aria-labelledby="recitation-original-title">
          <div className="recitation-section-heading">
            <div>
              <p className="comparison-label">第一阶段</p>
              <h2 id="recitation-original-title">背诵原文</h2>
              <p className="recitation-section-description">
                背诵完整英文原稿，需要脱稿试背时可以点右侧隐藏原文。
              </p>
            </div>
            <button
              type="button"
              className="recitation-toggle-button"
              onClick={() => setIsOriginalVisible((visible) => !visible)}
            >
              {isOriginalVisible ? "隐藏原文" : "显示原文"}
            </button>
          </div>

          {isOriginalVisible ? (
            <p className="recitation-original">
              {segments.map((segment) => segment.text).join(" ")}
            </p>
          ) : (
            <div className="recitation-hidden">
              <span aria-hidden="true">✓</span>
              <p>原文已隐藏</p>
            </div>
          )}

          <div className="recitation-audio-assist">
            <div className="recitation-audio-meta">
              <strong>材料音频</strong>
            </div>
            {material.audio && (
              <AudioPlayer
                src={material.audio}
                onDurationReady={setOriginalDuration}
              />
            )}
          </div>
        </section>

        <section className="recitation-section recording-section" aria-labelledby="recording-title">
          <div className="recitation-section-heading">
            <div>
              <p className="comparison-label">第二阶段</p>
              <h2 id="recording-title">2. 背诵录音挑战</h2>
              <p className="recitation-section-description">
                隐藏原文后脱稿背诵，并录下你的完整练习。
              </p>
            </div>
            <p className={isRecording ? "recording-clock is-recording" : "recording-clock"}>
              {isRecording
                ? isRecordingPaused
                  ? "录音已暂停"
                  : "录音中"
                : recordedDuration === null
                  ? "准备录音"
                  : "录音完成"}
              <strong>{formatTime(recordingTime)}</strong>
            </p>
          </div>

          <div className="recording-controls">
            {isRecording ? (
              <>
                <button
                  type="button"
                  className="recording-secondary-button"
                  onClick={isRecordingPaused ? resumeRecording : pauseRecording}
                >
                  <span aria-hidden="true">{isRecordingPaused ? "▶" : "Ⅱ"}</span>
                  {isRecordingPaused ? "继续录音" : "暂停录音"}
                </button>
                <button
                  type="button"
                  className="recording-button recording-stop-button"
                  onClick={stopRecording}
                >
                  <span aria-hidden="true">■</span>
                  结束录音
                </button>
              </>
            ) : recordedDuration === null ? (
              <button
                type="button"
                className="recording-button"
                onClick={() => void startRecording()}
              >
                <span aria-hidden="true">●</span>
                开始录音
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="recording-secondary-button"
                  onClick={() => void toggleRecordingPlayback()}
                >
                  <span aria-hidden="true">{isRecordingPlaybackActive ? "Ⅱ" : "▶"}</span>
                  {isRecordingPlaybackActive ? "暂停回听" : "回听录音"}
                </button>
                <button
                  type="button"
                  className="recording-button"
                  onClick={() => void startRecording()}
                >
                  <span aria-hidden="true">●</span>
                  重新录音
                </button>
              </>
            )}
          </div>

          {recordingError && (
            <p className="recording-error" role="alert">{recordingError}</p>
          )}

          {recordedDuration !== null && recordingUrl && (
            <audio
              ref={recordingAudioRef}
              src={recordingUrl}
              className="recording-audio-element"
              aria-label="我的背诵录音"
              onPlay={() => setIsRecordingPlaybackActive(true)}
              onPause={() => setIsRecordingPlaybackActive(false)}
              onEnded={() => setIsRecordingPlaybackActive(false)}
            />
          )}

          {recordedDuration !== null && <div className="feedback-metrics">
            <div>
              <span>用户录音时长</span>
              <strong>{formatTime(recordedDuration)}</strong>
            </div>
            <div>
              <span>原音时长</span>
              <strong>{originalDuration > 0 ? formatTime(originalDuration) : "载入中"}</strong>
            </div>
            <div>
              <span>时间差</span>
              <strong>
                {speedDifference === null ? "—" : `${speedDifference.toFixed(1)} 秒`}
              </strong>
            </div>
          </div>}

          {speedFeedback && speedDifference !== null && (
            <div className={`speed-feedback ${speedFeedback.className}`}>
              <div>
                <span>与原音时长相差 {speedDifference.toFixed(1)} 秒</span>
                <strong>{speedFeedback.level}</strong>
              </div>
              <p>{speedFeedback.message}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ReviewCenter({
  initialVocabulary,
  learnedCourses,
}: {
  initialVocabulary: VocabularyEntry[];
  learnedCourses: Array<{ lessonId: string; lessonTitle: string }>;
}) {
  const { user } = useAuth();
  const [vocabulary, setVocabulary] = useState(initialVocabulary);
  const [selectedLessonId, setSelectedLessonId] = useState("all");
  const courseOptions = new Map(
    learnedCourses.map((course) => [course.lessonId, course.lessonTitle]),
  );
  vocabulary.forEach((entry) => {
    if (entry.lessonId) {
      courseOptions.set(entry.lessonId, entry.lessonTitle);
    }
  });
  const filteredVocabulary =
    selectedLessonId === "all"
      ? vocabulary
      : vocabulary.filter((entry) => entry.lessonId === selectedLessonId);

  const removeWord = (entryToRemove: VocabularyEntry) => {
    const nextVocabulary = vocabulary.filter(
      (entry) =>
        !(
          entry.lessonId === entryToRemove.lessonId &&
          entry.word.toLocaleLowerCase("en") ===
            entryToRemove.word.toLocaleLowerCase("en")
        ),
    );

    setVocabulary(nextVocabulary);

    try {
      window.localStorage.setItem(
        vocabularyStorageKey,
        JSON.stringify(nextVocabulary),
      );
    } catch {
      // The current view still updates if browser storage is unavailable.
    }

    if (user) {
      void deleteVocabularyEntry(String(user.id), entryToRemove).catch(() => {
        // Local deletion remains effective if cloud sync fails.
      });
    }
  };

  return (
    <main className="review-page">
      <div className="section-shell">
        <section className="review-hero">
          <p className="eyebrow">复习阶段</p>
          <h1>复习中心</h1>
          <p>复习你的收藏单词，巩固长期记忆。</p>
        </section>

        <section className="vocabulary-section" aria-labelledby="vocabulary-title">
          <div className="vocabulary-heading">
            <div>
              <p className="comparison-label">Vocabulary</p>
              <h2 id="vocabulary-title">我的生词本</h2>
            </div>
            {filteredVocabulary.length > 0 && (
              <span>{filteredVocabulary.length} 个单词</span>
            )}
          </div>

          <div className="review-course-filter" aria-label="按课程筛选生词">
            <button
              type="button"
              className={selectedLessonId === "all" ? "is-active" : ""}
              aria-pressed={selectedLessonId === "all"}
              onClick={() => setSelectedLessonId("all")}
            >
              全部课程
            </button>
            {Array.from(courseOptions).map(([lessonId, lessonTitle]) => (
              <button
                type="button"
                className={selectedLessonId === lessonId ? "is-active" : ""}
                aria-pressed={selectedLessonId === lessonId}
                onClick={() => setSelectedLessonId(lessonId)}
                key={lessonId}
              >
                {lessonTitle}
              </button>
            ))}
          </div>

          {filteredVocabulary.length > 0 ? (
            <div className="vocabulary-grid">
              {filteredVocabulary.map((entry, index) => (
                <article
                  className="vocabulary-card"
                  key={`${entry.lessonId}-${entry.word}-${index}`}
                >
                  <div className="vocabulary-word-row">
                    <h3>{entry.word}</h3>
                    <button
                      type="button"
                      className="vocabulary-pronunciation-button"
                      aria-label={`播放 ${entry.word} 的英文发音`}
                      title="播放英文发音"
                      onClick={() => speakWord(entry.word)}
                    >
                      <span aria-hidden="true">🔊</span>
                    </button>
                  </div>

                  <p className="vocabulary-meaning">{entry.meaning}</p>

                  <div className="vocabulary-example">
                    <span>原文例句</span>
                    <p>{entry.example || "暂无例句"}</p>
                  </div>

                  <div className="vocabulary-card-footer">
                    <p>
                      <span>来源课程</span>
                      <strong>{entry.lessonTitle || "未知课程"}</strong>
                    </p>
                    <button
                      type="button"
                      className="vocabulary-delete-button"
                      onClick={() => removeWord(entry)}
                      aria-label={`从生词本删除 ${entry.word}`}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="vocabulary-empty">
              <span aria-hidden="true">Aa</span>
              <h3>
                {vocabulary.length === 0
                  ? "你的生词本还是空的"
                  : "这篇课程还没有收藏单词"}
              </h3>
              {vocabulary.length === 0 && (
                <p>
                  学习过程中点击单词，
                  <br />
                  即可加入这里复习。
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function LearningHistory({
  records,
  onOpenRecord,
}: {
  records: LearningRecord[];
  onOpenRecord: (record: LearningRecord) => void;
}) {
  return (
    <main className="review-page">
      <div className="section-shell">
        <section className="review-hero">
          <p className="eyebrow">Learning Archive</p>
          <h1>学习记录</h1>
          <p>查看正在学习和已经完成的课程，继续你的训练。</p>
        </section>

        {records.length > 0 ? (
          <section className="history-list" aria-label="课程学习记录">
            {records.map((record) => (
              <button
                type="button"
                className="history-card"
                onClick={() => onOpenRecord(record)}
                key={record.lessonId}
              >
                <div>
                  <span
                    className={`history-status is-${record.status}`}
                  >
                    {record.status === "completed" ? "已完成" : "进行中"}
                  </span>
                  <h2>{record.lessonTitle}</h2>
                  <p>最近学习：{formatStudiedAt(record.lastStudiedAt)}</p>
                </div>
                <span className="history-card-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </section>
        ) : (
          <div className="vocabulary-empty">
            <span aria-hidden="true">01</span>
            <h3>还没有学习记录</h3>
            <p>选择一篇课程开始学习后，记录会出现在这里。</p>
          </div>
        )}
      </div>
    </main>
  );
}

function LearningRecordDetail({
  record,
  material,
  vocabulary,
  dictation,
  onBack,
  onRecite,
}: {
  record: LearningRecord;
  material?: Material;
  vocabulary: VocabularyEntry[];
  dictation: string;
  onBack: () => void;
  onRecite: () => void;
}) {
  const segments = material?.segments ?? [];

  return (
    <main className="record-detail-page">
      <div className="preparation-shell">
        <button type="button" className="back-button" onClick={onBack}>
          <span aria-hidden="true">←</span> 返回学习记录
        </button>

        <div className="record-detail-heading">
          <span className={`history-status is-${record.status}`}>
            {record.status === "completed" ? "已完成" : "进行中"}
          </span>
          <h1>{record.lessonTitle}</h1>
          <p>最近学习：{formatStudiedAt(record.lastStudiedAt)}</p>
        </div>

        <section className="record-section">
          <div className="record-section-heading">
            <div>
              <p className="comparison-label">Original</p>
              <h2>原文复习</h2>
            </div>
            <button type="button" className="recitation-toggle-button" onClick={onRecite}>
              重新背诵
            </button>
          </div>
          {segments.length > 0 ? (
            <p className="record-original">
              {segments.map((segment) => segment.text).join(" ")}
            </p>
          ) : (
            <p className="record-empty-copy">本课程暂无原文。</p>
          )}
          {material?.audio && <AudioPlayer src={material.audio} />}
        </section>

        <section className="record-section">
          <div className="record-section-heading">
            <div>
              <p className="comparison-label">Dictation</p>
              <h2>我的听写记录</h2>
            </div>
          </div>
          <pre className="record-dictation">
            {dictation || "暂无听写记录。"}
          </pre>
        </section>

        <section className="record-section">
          <div className="record-section-heading">
            <div>
              <p className="comparison-label">Vocabulary</p>
              <h2>我的生词</h2>
            </div>
          </div>
          {vocabulary.length > 0 ? (
            <div className="record-vocabulary-list">
              {vocabulary.map((entry) => (
                <article key={`${entry.lessonId}:${entry.word}`}>
                  <div>
                    <strong>{entry.word}</strong>
                    <button
                      type="button"
                      aria-label={`播放 ${entry.word} 的英文发音`}
                      onClick={() => speakWord(entry.word)}
                    >
                      🔊
                    </button>
                  </div>
                  <p>{entry.meaning}</p>
                  <span>{entry.example || "暂无例句"}</span>
                </article>
              ))}
            </div>
          ) : (
            <p className="record-empty-copy">暂无生词。</p>
          )}
        </section>

        <section className="record-section">
          <div className="record-section-heading">
            <div>
              <p className="comparison-label">Recitation</p>
              <h2>我的背诵记录</h2>
            </div>
          </div>
          {record.recitationCompleted ? (
            <div className="recitation-record">
              <span>完成状态</span>
              <strong>已完成</strong>
              <span>熟练度结果</span>
              <strong>{record.proficiency || "已完成"}</strong>
            </div>
          ) : (
            <p className="record-empty-copy">暂无记录。</p>
          )}
        </section>
      </div>
    </main>
  );
}

export default function Home() {
  const { user } = useAuth();
  const materialsRef = useRef<HTMLElement>(null);
  const [duration, setDuration] = useState<Duration>("10分钟内");
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [learningStep, setLearningStep] = useState<2 | 3 | 4>(2);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [reviewVocabulary, setReviewVocabulary] = useState<VocabularyEntry[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [learningRecords, setLearningRecords] = useState<LearningRecord[]>([]);
  const [openRecord, setOpenRecord] = useState<LearningRecord | null>(null);
  const [openRecordMaterial, setOpenRecordMaterial] = useState<Material | null>(null);
  const filteredMaterials = materials.filter(
    (material) => material.duration === duration,
  );

  const saveRecord = (
    material: Material,
    updates: Partial<
      Pick<LearningRecord, "status" | "recitationCompleted" | "proficiency">
    > = {},
  ) => {
    const record = saveLearningRecord(material, updates);
    if (user && record) {
      void syncLearningRecord(String(user.id), record).catch(() => {
        // Local learning records remain authoritative if cloud sync fails.
      });
    }
  };

  const scrollToMaterials = () => {
    materialsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const returnToMaterials = () => {
    setIsReviewOpen(false);
    setIsHistoryOpen(false);
    setOpenRecord(null);
    setOpenRecordMaterial(null);
    setSelectedMaterial(null);
    setLearningStep(2);
  };

  const openReviewCenter = () => {
    setReviewVocabulary(readVocabulary());
    setSelectedMaterial(null);
    setIsHistoryOpen(false);
    setOpenRecord(null);
    setOpenRecordMaterial(null);
    setIsReviewOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openLearningHistory = () => {
    setLearningRecords(readLearningRecords());
    setSelectedMaterial(null);
    setIsReviewOpen(false);
    setOpenRecord(null);
    setOpenRecordMaterial(null);
    setIsHistoryOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const chooseMaterial = async (material: Material) => {
    const loadedMaterial = await loadMaterial(material.id);
    if (!loadedMaterial) return;
    saveRecord(loadedMaterial);
    setIsReviewOpen(false);
    setIsHistoryOpen(false);
    setOpenRecord(null);
    setOpenRecordMaterial(null);
    setSelectedMaterial(loadedMaterial);
    setLearningStep(2);
  };

  const openLearningRecord = async (record: LearningRecord) => {
    const material = await loadMaterial(record.lessonId);
    setOpenRecordMaterial(material);
    setOpenRecord(record);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reopenRecitation = async (record: LearningRecord) => {
    const material = await loadMaterial(record.lessonId);
    if (!material) return;
    saveRecord(material);
    setOpenRecord(null);
    setOpenRecordMaterial(null);
    setIsHistoryOpen(false);
    setSelectedMaterial(material);
    setLearningStep(4);
  };

  if (selectedMaterial) {
    return (
      <>
        <Header
          onStart={returnToMaterials}
          onReview={openReviewCenter}
          onHistory={openLearningHistory}
        />
        {learningStep === 2 ? (
          <DictationView
            material={selectedMaterial}
            onBack={returnToMaterials}
            onCompare={() => setLearningStep(3)}
          />
        ) : learningStep === 3 ? (
          <ComparisonView
            material={selectedMaterial}
            onBack={() => setLearningStep(2)}
            onComplete={() => setLearningStep(4)}
          />
        ) : (
          <RecitationView
            material={selectedMaterial}
            onBack={() => setLearningStep(3)}
            onRecordingComplete={(proficiency) =>
              saveRecord(selectedMaterial, {
                status: "completed",
                recitationCompleted: true,
                proficiency,
              })
            }
          />
        )}
      </>
    );
  }

  if (isReviewOpen) {
    return (
      <>
        <Header
          onStart={returnToMaterials}
          onReview={openReviewCenter}
          onHistory={openLearningHistory}
          activePage="review"
        />
        <ReviewCenter
          initialVocabulary={reviewVocabulary}
          learnedCourses={readLearningRecords().map((record) => ({
            lessonId: record.lessonId,
            lessonTitle: record.lessonTitle,
          }))}
          key={reviewVocabulary.map((entry) => `${entry.lessonId}:${entry.word}`).join("|")}
        />
      </>
    );
  }

  if (isHistoryOpen) {
    let savedDictation = "";
    if (openRecord) {
      try {
        savedDictation =
          window.localStorage.getItem(
            `shangmethod:dictation:${openRecord.lessonId}`,
          ) ?? "";
      } catch {
        savedDictation = "";
      }
    }

    return (
      <>
        <Header
          onStart={returnToMaterials}
          onReview={openReviewCenter}
          onHistory={openLearningHistory}
          activePage="history"
        />
        {openRecord ? (
          <LearningRecordDetail
            record={openRecord}
            material={openRecordMaterial ?? undefined}
            vocabulary={readVocabulary().filter(
              (entry) => entry.lessonId === openRecord.lessonId,
            )}
            dictation={savedDictation}
            onBack={() => setOpenRecord(null)}
            onRecite={() => reopenRecitation(openRecord)}
          />
        ) : (
          <LearningHistory
            records={learningRecords}
            onOpenRecord={openLearningRecord}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Header
        onStart={scrollToMaterials}
        onReview={openReviewCenter}
        onHistory={openLearningHistory}
      />
      <main>
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">尚姐学习法</p>
              <h1>
                回归语言学习本质，
                <br />
                重塑语言表达本能
              </h1>
              <p className="hero-description">
                ——回到孩子学习母语的方式，通过大量模仿、背诵和输出，让你成为接近Native Speaker的英语使用者。
              </p>
              <button className="primary-button" type="button" onClick={scrollToMaterials}>
                开始学习
              </button>
            </div>
          </div>
        </section>

        <section className="process-section">
          <div className="section-shell">
            <div className="section-intro">
              <div>
                <p className="eyebrow">学习路径</p>
                <h2>一次完整、扎实的学习循环</h2>
              </div>
            </div>
            <ProgressSteps activeStep={0} />
          </div>
        </section>

        <section className="materials-section" ref={materialsRef}>
          <div className="section-shell">
            <div className="materials-heading">
              <div>
                <p className="eyebrow">第一步 · 选择材料</p>
                <h2>今天想听什么？</h2>
              </div>
              <p>选择音频时长，找到感兴趣的材料。</p>
            </div>

            <div className="materials-workspace">
              <aside className="filter-panel" aria-label="材料筛选">
                <FilterGroup
                  label="音频时长"
                  options={["10分钟内", "10-20分钟", "20-30分钟", "30分钟以上"] as const}
                  selected={duration}
                  onSelect={setDuration}
                />
              </aside>

              <div className="results-panel">
                <div className="results-summary" aria-live="polite">
                  <div>
                    <span>{duration}</span>
                  </div>
                  <p>{filteredMaterials.length}篇材料</p>
                </div>

                <div className="materials-grid">
                  {filteredMaterials.map((material) => (
                    <MaterialCard
                      material={material}
                      onChoose={chooseMaterial}
                      key={material.id}
                    />
                  ))}
                </div>

                {filteredMaterials.length === 0 && (
                  <div className="empty-results">
                    <span>暂无匹配材料</span>
                    <p>这个组合的示例材料还在准备中，请换一个时长或分类。</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-inner">
          <div>
            <strong>ShangMethod</strong>
            <span>ShangMethod</span>
          </div>
          <p>认真听，反复练，让英语成为本能。</p>
        </div>
      </footer>
    </>
  );
}
