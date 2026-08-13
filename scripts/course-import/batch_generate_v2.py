from __future__ import annotations

import argparse
import json
from pathlib import Path

from config import COURSE_STATUS_PATH, LESSONS_ROOT, STAGING_ROOT
from merge_alignment import build_transcript_v2, load_json, write_transcript_v2
from models import CourseStatus


def write_json_atomic(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    json.loads(temporary_path.read_text(encoding="utf-8"))
    temporary_path.replace(path)


def load_statuses(status_path: Path) -> dict[str, dict]:
    raw_statuses = json.loads(status_path.read_text(encoding="utf-8"))
    if not isinstance(raw_statuses, dict):
        raise ValueError("course-status.json must contain an object")
    for lesson_id, raw_status in raw_statuses.items():
        CourseStatus.model_validate(raw_status)
        if not isinstance(lesson_id, str) or not lesson_id:
            raise ValueError("Course status contains an invalid lesson id")
    return raw_statuses


def batch_generate_v2(
    *,
    lessons_root: Path = LESSONS_ROOT,
    staging_root: Path = STAGING_ROOT,
    status_path: Path = COURSE_STATUS_PATH,
    report_path: Path | None = None,
) -> dict:
    statuses = load_statuses(status_path)
    generated: list[dict] = []
    existing_skipped: list[dict] = []
    missing_alignment_skipped: list[dict] = []
    failed: list[dict] = []
    status_changed = False

    eligible_ids = [
        lesson_id
        for lesson_id, status in statuses.items()
        if status["alignmentStatus"] == "passed"
    ]

    for lesson_id in eligible_ids:
        lesson_directory = lessons_root / lesson_id
        transcript_path = lesson_directory / "transcript.json"
        transcript_v2_path = lesson_directory / "transcript-v2.json"
        alignment_path = (
            staging_root / lesson_id / "alignment" / "alignment.json"
        )

        if transcript_v2_path.is_file():
            existing_skipped.append(
                {
                    "lessonId": lesson_id,
                    "path": str(transcript_v2_path),
                    "transcriptVersion": statuses[lesson_id][
                        "transcriptVersion"
                    ],
                }
            )
            continue

        if not alignment_path.is_file():
            missing_alignment_skipped.append(
                {
                    "lessonId": lesson_id,
                    "expectedPath": str(alignment_path),
                }
            )
            continue

        try:
            if not transcript_path.is_file():
                raise FileNotFoundError(f"Missing transcript.json: {transcript_path}")
            transcript_v2 = build_transcript_v2(
                load_json(transcript_path),
                load_json(alignment_path),
            )
            write_transcript_v2(transcript_v2, transcript_v2_path)
            statuses[lesson_id]["transcriptVersion"] = 2
            CourseStatus.model_validate(statuses[lesson_id])
            status_changed = True
            generated.append(
                {
                    "lessonId": lesson_id,
                    "sentenceCount": len(transcript_v2["sentences"]),
                    "path": str(transcript_v2_path),
                }
            )
        except Exception as error:
            if transcript_v2_path.is_file():
                transcript_v2_path.unlink()
            failed.append(
                {
                    "lessonId": lesson_id,
                    "reason": str(error),
                }
            )

    if status_changed:
        write_json_atomic(status_path, statuses)

    report = {
        "eligibleCount": len(eligible_ids),
        "generated": generated,
        "existingSkipped": existing_skipped,
        "missingAlignmentSkipped": missing_alignment_skipped,
        "failed": failed,
    }
    write_json_atomic(
        report_path or staging_root / "batch-v2-report.json",
        report,
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate transcript-v2.json for every aligned course."
    )
    parser.add_argument("--lessons-root", type=Path, default=LESSONS_ROOT)
    parser.add_argument("--staging-root", type=Path, default=STAGING_ROOT)
    parser.add_argument("--status", type=Path, default=COURSE_STATUS_PATH)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    report = batch_generate_v2(
        lessons_root=args.lessons_root,
        staging_root=args.staging_root,
        status_path=args.status,
        report_path=args.report,
    )
    print(
        f"Eligible: {report['eligibleCount']}; "
        f"generated: {len(report['generated'])}; "
        f"existing: {len(report['existingSkipped'])}; "
        f"missing alignment: {len(report['missingAlignmentSkipped'])}; "
        f"failed: {len(report['failed'])}"
    )
    if report["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
