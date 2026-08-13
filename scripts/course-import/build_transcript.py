from __future__ import annotations

import argparse
import json
from pathlib import Path

from models import Sentence, Transcript


def build_transcript(
    *,
    lesson_id: str,
    title: str,
    audio_analysis: dict,
    extraction: dict,
) -> Transcript:
    duration_seconds = float(audio_analysis["durationSeconds"])
    translation = extraction["chinese"].strip()
    english = extraction["english"].strip()
    return Transcript(
        id=lesson_id,
        title=title.strip(),
        durationSeconds=duration_seconds,
        durationCategory=audio_analysis["durationCategory"],
        summary=f"TED演讲《{title.strip()}》的中英文精听材料。",
        audio=f"/lessons/{lesson_id}/audio.mp3",
        translation=translation,
        sentences=[
            Sentence(
                id=1,
                start=0,
                end=duration_seconds,
                english=english,
                chinese=translation,
            )
        ],
    )


def write_transcript(transcript: Transcript, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            transcript.model_dump(),
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a one-segment transcript.")
    parser.add_argument("lesson_id")
    parser.add_argument("title")
    parser.add_argument("audio_analysis", type=Path)
    parser.add_argument("extracted_json", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    audio_analysis = json.loads(args.audio_analysis.read_text(encoding="utf-8"))
    extraction = json.loads(args.extracted_json.read_text(encoding="utf-8"))
    transcript = build_transcript(
        lesson_id=args.lesson_id,
        title=args.title,
        audio_analysis=audio_analysis,
        extraction=extraction,
    )
    write_transcript(transcript, args.output)
    print(f"Transcript: {args.output}")


if __name__ == "__main__":
    main()
