from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def build_transcript_v2(transcript: dict, alignment: dict) -> dict:
    lesson_id = transcript.get("id")
    if lesson_id != alignment.get("lessonId"):
        raise ValueError(
            f"Lesson id mismatch: transcript={lesson_id}, "
            f"alignment={alignment.get('lessonId')}"
        )

    duration = float(transcript["durationSeconds"])
    aligned_sentences: list[dict] = []
    previous_end = -1.0
    for index, segment in enumerate(alignment.get("segments", []), start=1):
        start = float(segment["start"])
        end = float(segment["end"])
        if segment.get("estimated"):
            raise ValueError(f"Sentence {index} has an estimated timestamp")
        if end <= start:
            raise ValueError(f"Sentence {index} has an invalid time range")
        if start < previous_end:
            raise ValueError(f"Sentence {index} overlaps the prior sentence")
        if end > duration + 0.5:
            raise ValueError(f"Sentence {index} exceeds the audio duration")
        english = str(segment.get("english", "")).strip()
        if not english:
            raise ValueError(f"Sentence {index} has no authoritative English")

        aligned_sentences.append(
            {
                "id": index,
                "start": round(start, 3),
                "end": round(min(end, duration), 3),
                "english": english,
                # Step 3 displays the top-level translation. Leaving this empty
                # avoids inventing an English-Chinese sentence correspondence.
                "chinese": "",
            }
        )
        previous_end = end

    if not aligned_sentences:
        raise ValueError("Alignment contains no sentences")

    return {
        "id": transcript["id"],
        "title": transcript["title"],
        "durationSeconds": transcript["durationSeconds"],
        "durationCategory": transcript["durationCategory"],
        "summary": transcript["summary"],
        "audio": transcript["audio"],
        "translation": transcript["translation"],
        "sentences": aligned_sentences,
    }


def write_transcript_v2(value: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge a reviewed English alignment into transcript-v2.json."
    )
    parser.add_argument("transcript", type=Path)
    parser.add_argument("alignment", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    value = build_transcript_v2(
        load_json(args.transcript),
        load_json(args.alignment),
    )
    write_transcript_v2(value, args.output)
    print(f"Transcript v2: {args.output}; sentences={len(value['sentences'])}")


if __name__ == "__main__":
    main()
