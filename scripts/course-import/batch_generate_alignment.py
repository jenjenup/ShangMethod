from __future__ import annotations

import argparse
import json
from pathlib import Path

from align_sentences import build_alignment, write_alignment
from batch_generate_v2 import load_statuses, write_json_atomic
from config import COURSE_STATUS_PATH, LESSONS_ROOT, STAGING_ROOT
from split_authoritative_text import (
    build_authoritative_sentences,
    write_authoritative_sentences,
)
from transcribe_audio import transcribe_audio, write_transcription
from validate_alignment import build_preview, validate_alignment, write_report


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def alignment_failure_reasons(alignment: dict, report: dict) -> list[str]:
    reasons = [str(error) for error in report.get("errors", [])]
    stats = report.get("stats", {})
    coverage = float(stats.get("overallCoverage", alignment.get("coverage", 0)))
    if coverage < 0.9:
        reasons.append(f"Alignment coverage is below 90%: {coverage:.1%}")
    unmatched = stats.get("unmatchedSentenceIds", [])
    if unmatched:
        reasons.append(f"Alignment has {len(unmatched)} unmatched sentences")
    overlaps = stats.get("overlappingSentenceIds", [])
    if overlaps:
        reasons.append(f"Alignment has {len(overlaps)} overlapping sentences")
    estimated_count = sum(
        bool(segment.get("estimated"))
        for segment in alignment.get("segments", [])
    )
    if estimated_count:
        reasons.append(
            f"Alignment has {estimated_count} estimated sentence timestamps"
        )
    return list(dict.fromkeys(reasons))


def batch_generate_alignment(
    *,
    lessons_root: Path = LESSONS_ROOT,
    staging_root: Path = STAGING_ROOT,
    status_path: Path = COURSE_STATUS_PATH,
    report_path: Path | None = None,
    lesson_ids: list[str] | None = None,
    model_name: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
    force_transcribe: bool = False,
) -> dict:
    statuses = load_statuses(status_path)
    pending_ids = [
        lesson_id
        for lesson_id, status in statuses.items()
        if status["alignmentStatus"] == "pending"
        and (lesson_ids is None or lesson_id in lesson_ids)
    ]
    unknown_requested_ids = sorted(
        set(lesson_ids or []) - set(statuses)
    )

    generated: list[dict] = []
    existing_skipped: list[dict] = []
    failed: list[dict] = [
        {
            "lessonId": lesson_id,
            "reason": "Lesson is missing from course-status.json",
        }
        for lesson_id in unknown_requested_ids
    ]
    status_changed = False

    for lesson_id in pending_ids:
        lesson_directory = lessons_root / lesson_id
        transcript_path = lesson_directory / "transcript.json"
        audio_path = lesson_directory / "audio.mp3"
        output_directory = staging_root / lesson_id / "alignment"
        authoritative_path = output_directory / "authoritative-sentences.json"
        whisper_path = output_directory / "whisper-words.json"
        alignment_path = output_directory / "alignment.json"
        alignment_report_path = output_directory / "alignment-report.json"
        preview_path = output_directory / "alignment-preview.txt"

        if alignment_path.is_file():
            existing_skipped.append(
                {
                    "lessonId": lesson_id,
                    "path": str(alignment_path),
                }
            )
            continue

        try:
            if not transcript_path.is_file():
                raise FileNotFoundError(f"Missing transcript.json: {transcript_path}")
            if not audio_path.is_file():
                raise FileNotFoundError(f"Missing audio.mp3: {audio_path}")
            output_directory.mkdir(parents=True, exist_ok=True)

            authoritative = build_authoritative_sentences(transcript_path)
            write_authoritative_sentences(authoritative, authoritative_path)

            if whisper_path.is_file() and not force_transcribe:
                transcription = load_json(whisper_path)
                if transcription.get("model") != model_name:
                    raise ValueError(
                        f"Cached Whisper model is "
                        f"{transcription.get('model')}; requested {model_name}. "
                        "Use --force-transcribe."
                    )
            else:
                transcription = transcribe_audio(
                    audio_path,
                    model_name=model_name,
                    device=device,
                    compute_type=compute_type,
                )
                write_transcription(transcription, whisper_path)

            alignment = build_alignment(
                lesson_id,
                authoritative,
                transcription,
            )
            write_alignment(alignment, alignment_path)
            validation = validate_alignment(alignment)
            write_report(
                validation,
                build_preview(alignment, validation),
                alignment_report_path,
                preview_path,
            )
            failure_reasons = alignment_failure_reasons(
                alignment,
                validation,
            )
            if failure_reasons:
                failed.append(
                    {
                        "lessonId": lesson_id,
                        "reason": "; ".join(failure_reasons),
                        "coverage": alignment["coverage"],
                        "output": str(output_directory),
                    }
                )
                continue

            statuses[lesson_id]["alignmentStatus"] = "passed"
            status_changed = True
            generated.append(
                {
                    "lessonId": lesson_id,
                    "sentenceCount": len(alignment["segments"]),
                    "coverage": alignment["coverage"],
                    "output": str(output_directory),
                }
            )
        except Exception as error:
            failed.append(
                {
                    "lessonId": lesson_id,
                    "reason": str(error),
                    "output": str(output_directory),
                }
            )

    if status_changed:
        write_json_atomic(status_path, statuses)

    report = {
        "model": model_name,
        "pendingSelectedCount": len(pending_ids),
        "generated": generated,
        "existingSkipped": existing_skipped,
        "failed": failed,
    }
    write_json_atomic(
        report_path or staging_root / "batch-alignment-report.json",
        report,
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate alignments for pending courses."
    )
    parser.add_argument("--lessons-root", type=Path, default=LESSONS_ROOT)
    parser.add_argument("--staging-root", type=Path, default=STAGING_ROOT)
    parser.add_argument("--status", type=Path, default=COURSE_STATUS_PATH)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--lesson-id", action="append", dest="lesson_ids")
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--force-transcribe", action="store_true")
    args = parser.parse_args()

    report = batch_generate_alignment(
        lessons_root=args.lessons_root,
        staging_root=args.staging_root,
        status_path=args.status,
        report_path=args.report,
        lesson_ids=args.lesson_ids,
        model_name=args.model,
        device=args.device,
        compute_type=args.compute_type,
        force_transcribe=args.force_transcribe,
    )
    print(
        f"Pending selected: {report['pendingSelectedCount']}; "
        f"generated: {len(report['generated'])}; "
        f"existing: {len(report['existingSkipped'])}; "
        f"failed: {len(report['failed'])}"
    )
    for result in report["generated"]:
        print(
            f"- {result['lessonId']}: "
            f"sentences={result['sentenceCount']}, "
            f"coverage={result['coverage']:.1%}"
        )
    for result in report["failed"]:
        print(f"- {result['lessonId']}: FAILED: {result['reason']}")
    if report["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
