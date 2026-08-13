from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from analyze_audio import analyze_audio
from build_transcript import build_transcript, write_transcript
from config import (
    DEFAULT_SOURCE_ROOT,
    LESSONS_ROOT,
    PILOT_PLAN_PATH,
    REPORTS_ROOT,
    STAGING_ROOT,
    source_directories,
)
from extract_pdf import extract_pdf
from generate_manifest import build_manifest, write_manifest
from inventory import scan_inventory
from match_materials import match_materials, write_reports
from validate_lessons import validate_transcript_file


def load_plan(plan_path: Path) -> list[dict]:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    ids = [item["id"] for item in plan]
    if len(ids) != len(set(ids)):
        raise ValueError("Pilot plan contains duplicate lesson ids")
    return plan


def locate_by_stem(directory: Path, stem: str, suffix: str) -> Path:
    path = directory / f"{stem}{suffix}"
    if not path.is_file():
        raise FileNotFoundError(path)
    return path


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def publish_lesson(
    lesson_id: str,
    staging_directory: Path,
    source_audio: Path,
    *,
    replace: bool,
) -> Path:
    destination = LESSONS_ROOT / lesson_id
    if destination.exists() and not replace:
        raise FileExistsError(
            f"Lesson already exists: {destination}. Use --replace to update it."
        )
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copy2(staging_directory / "transcript.json", destination / "transcript.json")
    shutil.copy2(source_audio, destination / "audio.mp3")
    return destination


def run(args: argparse.Namespace) -> dict:
    pdf_directory, audio_directory = source_directories(args.source_root)
    REPORTS_ROOT.mkdir(parents=True, exist_ok=True)
    STAGING_ROOT.mkdir(parents=True, exist_ok=True)

    inventory = scan_inventory(args.source_root)
    write_json(REPORTS_ROOT / "inventory.json", inventory)
    matches = match_materials(args.source_root)
    write_reports(
        matches,
        REPORTS_ROOT / "matches.json",
        REPORTS_ROOT / "matches.csv",
    )

    plan = load_plan(args.plan)
    if args.lesson_id:
        plan = [item for item in plan if item["id"] == args.lesson_id]
        if not plan:
            raise ValueError(f"Lesson id not found in plan: {args.lesson_id}")

    results: list[dict] = []
    published: list[str] = []
    for item in plan:
        lesson_id = item["id"]
        pdf_path = locate_by_stem(pdf_directory, item["pdfStem"], ".pdf")
        audio_path = locate_by_stem(audio_directory, item["audioStem"], ".mp3")
        staging_directory = STAGING_ROOT / lesson_id
        staging_directory.mkdir(parents=True, exist_ok=True)

        audio_analysis = analyze_audio(audio_path)
        write_json(staging_directory / "audio-analysis.json", audio_analysis)
        extraction = extract_pdf(pdf_path, staging_directory)
        transcript = build_transcript(
            lesson_id=lesson_id,
            title=item["title"],
            audio_analysis=audio_analysis,
            extraction=extraction,
        )
        transcript_path = staging_directory / "transcript.json"
        write_transcript(transcript, transcript_path)
        validation = validate_transcript_file(transcript_path, audio_path)
        write_json(staging_directory / "validation.json", validation)

        result = {
            "id": lesson_id,
            "pdf": str(pdf_path),
            "audio": str(audio_path),
            "staging": str(staging_directory),
            "valid": validation["valid"],
            "warnings": validation["warnings"],
            "englishCharacters": validation.get("stats", {}).get(
                "englishCharacters", 0
            ),
            "chineseCharacters": validation.get("stats", {}).get(
                "chineseCharacters", 0
            ),
        }
        results.append(result)

        if args.publish and validation["valid"]:
            publish_lesson(
                lesson_id,
                staging_directory,
                audio_path,
                replace=args.replace,
            )
            published.append(lesson_id)

    manifest_count = None
    if args.publish:
        entries = build_manifest(LESSONS_ROOT)
        write_manifest(entries, LESSONS_ROOT / "lessons.json")
        manifest_count = len(entries)

    report = {
        "mode": "publish" if args.publish else "dry-run",
        "sourceRoot": str(args.source_root),
        "processed": len(results),
        "published": published,
        "manifestCount": manifest_count,
        "results": results,
    }
    write_json(REPORTS_ROOT / "pilot-run.json", report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the pilot course importer.")
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--plan", type=Path, default=PILOT_PLAN_PATH)
    parser.add_argument("--lesson-id")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()

    report = run(args)
    print(
        f"Mode: {report['mode']}; processed: {report['processed']}; "
        f"published: {len(report['published'])}"
    )
    for result in report["results"]:
        print(
            f"- {result['id']}: valid={result['valid']}, "
            f"warnings={len(result['warnings'])}, "
            f"EN={result['englishCharacters']}, "
            f"ZH={result['chineseCharacters']}"
        )
    if any(not result["valid"] for result in report["results"]):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
