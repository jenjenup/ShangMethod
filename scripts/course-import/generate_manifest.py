from __future__ import annotations

import argparse
import json
from pathlib import Path

from config import COURSE_STATUS_PATH, LESSONS_ROOT
from models import CourseStatus, ManifestEntry, Transcript


def load_course_status(status_path: Path) -> dict[str, CourseStatus]:
    raw_status = json.loads(status_path.read_text(encoding="utf-8"))
    if not isinstance(raw_status, dict):
        raise ValueError("course-status.json must contain an object")
    return {
        lesson_id: CourseStatus.model_validate(status)
        for lesson_id, status in raw_status.items()
    }


def build_manifest(
    lessons_root: Path,
    status_path: Path = COURSE_STATUS_PATH,
) -> list[ManifestEntry]:
    existing_manifest_path = lessons_root / "lessons.json"
    existing_order: list[str] = []
    if existing_manifest_path.is_file():
        existing_data = json.loads(existing_manifest_path.read_text(encoding="utf-8"))
        existing_order = [item["id"] for item in existing_data]

    statuses = load_course_status(status_path)
    entries: dict[str, ManifestEntry] = {}
    for lesson_id, status in statuses.items():
        if not (
            status.importStatus == "completed"
            and status.reviewStatus == "approved"
            and status.published
        ):
            continue

        transcript_name = (
            "transcript-v2.json"
            if status.transcriptVersion == 2
            else "transcript.json"
        )
        transcript_path = lessons_root / lesson_id / transcript_name
        if not transcript_path.is_file():
            raise ValueError(
                f"Published lesson is missing {transcript_name}: {lesson_id}"
            )
        transcript = Transcript.model_validate_json(
            transcript_path.read_text(encoding="utf-8")
        )
        if transcript.id in entries:
            raise ValueError(f"Duplicate lesson id: {transcript.id}")
        if transcript_path.parent.name != transcript.id:
            raise ValueError(
                f"Folder name {transcript_path.parent.name} does not match "
                f"transcript id {transcript.id}"
            )
        audio_path = transcript_path.parent / "audio.mp3"
        if not audio_path.is_file():
            raise ValueError(f"Missing audio: {audio_path}")
        entries[transcript.id] = ManifestEntry(
            id=transcript.id,
            title=transcript.title,
            durationCategory=transcript.durationCategory,
            summary=transcript.summary,
            audio=transcript.audio,
            transcript=f"/lessons/{transcript.id}/{transcript_name}",
        )

    ordered_ids = [lesson_id for lesson_id in existing_order if lesson_id in entries]
    ordered_ids.extend(sorted(set(entries) - set(ordered_ids)))
    return [entries[lesson_id] for lesson_id in ordered_ids]


def write_manifest(entries: list[ManifestEntry], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(".json.tmp")
    temporary_path.write_text(
        json.dumps(
            [entry.model_dump() for entry in entries],
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    json.loads(temporary_path.read_text(encoding="utf-8"))
    temporary_path.replace(output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate lessons.json.")
    parser.add_argument("--lessons-root", type=Path, default=LESSONS_ROOT)
    parser.add_argument(
        "--output",
        type=Path,
        default=LESSONS_ROOT / "lessons.json",
    )
    parser.add_argument("--status", type=Path, default=COURSE_STATUS_PATH)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    entries = build_manifest(args.lessons_root, args.status)
    if args.check:
        print(f"Manifest valid: {len(entries)} lessons")
        return
    write_manifest(entries, args.output)
    print(f"Manifest generated: {args.output} ({len(entries)} lessons)")


if __name__ == "__main__":
    main()
