from __future__ import annotations

import argparse
import json
from pathlib import Path

from align_sentences import build_alignment, write_alignment
from config import LESSONS_ROOT, SCRIPT_ROOT, STAGING_ROOT
from split_authoritative_text import (
    build_authoritative_sentences,
    write_authoritative_sentences,
)
from transcribe_audio import transcribe_audio, write_transcription
from validate_alignment import build_preview, validate_alignment, write_report


DEFAULT_ALIGNMENT_PLAN = SCRIPT_ROOT / "alignment-plan.json"


def load_json(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8"))


def run_lesson(
    lesson_id: str,
    *,
    model_name: str,
    device: str,
    compute_type: str,
    force_transcribe: bool,
) -> dict:
    lesson_directory = LESSONS_ROOT / lesson_id
    transcript_path = lesson_directory / "transcript.json"
    audio_path = lesson_directory / "audio.mp3"
    if not transcript_path.is_file():
        raise FileNotFoundError(transcript_path)
    if not audio_path.is_file():
        raise FileNotFoundError(audio_path)

    output_directory = STAGING_ROOT / lesson_id / "alignment"
    output_directory.mkdir(parents=True, exist_ok=True)
    authoritative_path = output_directory / "authoritative-sentences.json"
    whisper_path = output_directory / "whisper-words.json"
    alignment_path = output_directory / "alignment.json"
    report_path = output_directory / "alignment-report.json"
    preview_path = output_directory / "alignment-preview.txt"

    authoritative = build_authoritative_sentences(transcript_path)
    write_authoritative_sentences(authoritative, authoritative_path)

    if whisper_path.is_file() and not force_transcribe:
        transcription = load_json(whisper_path)
        if transcription.get("model") != model_name:
            raise ValueError(
                f"Cached Whisper model is {transcription.get('model')}; "
                f"requested {model_name}. Use --force-transcribe."
            )
    else:
        transcription = transcribe_audio(
            audio_path,
            model_name=model_name,
            device=device,
            compute_type=compute_type,
        )
        write_transcription(transcription, whisper_path)

    alignment = build_alignment(lesson_id, authoritative, transcription)
    write_alignment(alignment, alignment_path)
    report = validate_alignment(alignment)
    write_report(
        report,
        build_preview(alignment, report),
        report_path,
        preview_path,
    )
    return {
        "lessonId": lesson_id,
        "valid": report["valid"],
        "coverage": alignment["coverage"],
        "sentenceCount": len(alignment["segments"]),
        "confidenceCounts": report["stats"]["confidenceCounts"],
        "unmatchedSentenceCount": len(
            report["stats"]["unmatchedSentenceIds"]
        ),
        "output": str(output_directory),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run sentence alignment MVP.")
    parser.add_argument("--plan", type=Path, default=DEFAULT_ALIGNMENT_PLAN)
    parser.add_argument("--lesson-id")
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--force-transcribe", action="store_true")
    args = parser.parse_args()

    plan = load_json(args.plan)
    if args.lesson_id:
        plan = [item for item in plan if item["id"] == args.lesson_id]
        if not plan:
            raise ValueError(f"Lesson id not found in plan: {args.lesson_id}")

    results = [
        run_lesson(
            item["id"],
            model_name=args.model,
            device=args.device,
            compute_type=args.compute_type,
            force_transcribe=args.force_transcribe,
        )
        for item in plan
    ]
    for result in results:
        print(
            f"- {result['lessonId']}: valid={result['valid']}, "
            f"coverage={result['coverage']:.1%}, "
            f"sentences={result['sentenceCount']}, "
            f"unmatched={result['unmatchedSentenceCount']}, "
            f"confidence={result['confidenceCounts']}"
        )
    if any(not result["valid"] for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
