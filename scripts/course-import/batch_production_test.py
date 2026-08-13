from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from pathlib import Path

from align_sentences import build_alignment, write_alignment
from analyze_audio import analyze_audio
from batch_generate_alignment import alignment_failure_reasons
from batch_generate_v2 import load_statuses, write_json_atomic
from build_transcript import build_transcript, write_transcript
from config import (
    COURSE_STATUS_PATH,
    DEFAULT_SOURCE_ROOT,
    LESSONS_ROOT,
    SCRIPT_ROOT,
    STAGING_ROOT,
    source_directories,
)
from extract_pdf import extract_pdf
from merge_alignment import build_transcript_v2, write_transcript_v2
from split_authoritative_text import (
    build_authoritative_sentences,
    write_authoritative_sentences,
)
from transcribe_audio import transcribe_audio, write_transcription
from validate_alignment import build_preview, validate_alignment, write_report
from validate_publish import validate_publish


DEFAULT_PLAN = SCRIPT_ROOT / "production-test-plan.json"


def load_plan(path: Path) -> list[dict]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(plan, list) or not plan:
        raise ValueError("Production test plan must be a non-empty array")
    lesson_ids = [item["id"] for item in plan]
    if len(lesson_ids) != len(set(lesson_ids)):
        raise ValueError("Production test plan contains duplicate lesson ids")
    return plan


def publish_course_atomically(
    lesson_id: str,
    *,
    lessons_root: Path,
    source_audio: Path,
    transcript_path: Path,
    transcript_v2_path: Path,
) -> Path:
    destination = lessons_root / lesson_id
    if destination.exists():
        raise FileExistsError(f"Course directory already exists: {destination}")
    lessons_root.mkdir(parents=True, exist_ok=True)
    temporary_directory = Path(
        tempfile.mkdtemp(prefix=f".{lesson_id}-", dir=lessons_root)
    )
    try:
        shutil.copy2(source_audio, temporary_directory / "audio.mp3")
        shutil.copy2(transcript_path, temporary_directory / "transcript.json")
        shutil.copy2(
            transcript_v2_path,
            temporary_directory / "transcript-v2.json",
        )
        temporary_directory.replace(destination)
    except Exception:
        shutil.rmtree(temporary_directory, ignore_errors=True)
        raise
    return destination


def build_validation_lesson(
    lesson_id: str,
    *,
    work_directory: Path,
    source_audio: Path,
    transcript_path: Path,
    transcript_v2_path: Path,
) -> Path:
    validation_root = work_directory / "validation-lessons"
    lesson_directory = validation_root / lesson_id
    if lesson_directory.exists():
        shutil.rmtree(lesson_directory)
    lesson_directory.mkdir(parents=True)
    shutil.copy2(transcript_path, lesson_directory / "transcript.json")
    shutil.copy2(transcript_v2_path, lesson_directory / "transcript-v2.json")
    (lesson_directory / "audio.mp3").symlink_to(source_audio)
    return validation_root


def run_production_test(
    *,
    plan_path: Path = DEFAULT_PLAN,
    source_root: Path = DEFAULT_SOURCE_ROOT,
    lessons_root: Path = LESSONS_ROOT,
    staging_root: Path = STAGING_ROOT,
    status_path: Path = COURSE_STATUS_PATH,
    report_path: Path | None = None,
    model_name: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
) -> dict:
    plan = load_plan(plan_path)
    statuses = load_statuses(status_path)
    pdf_directory, audio_directory = source_directories(source_root)
    results: list[dict] = []

    for index, item in enumerate(plan, start=1):
        lesson_id = item["id"]
        work_directory = staging_root / "production-test" / lesson_id
        alignment_directory = staging_root / lesson_id / "alignment"
        transcript_path = work_directory / "transcript.json"
        transcript_v2_path = work_directory / "transcript-v2.json"
        print(
            f"[{index:02d}/{len(plan):02d}] START {lesson_id}: {item['title']}",
            flush=True,
        )
        result = {
            "lessonId": lesson_id,
            "title": item["title"],
            "selectionProfile": item.get("selectionProfile", ""),
            "alignmentCoverage": None,
            "alignmentSentenceCount": 0,
            "v2Generated": False,
            "publishValidation": None,
            "published": False,
            "failureReasons": [],
        }
        try:
            if lesson_id in statuses:
                raise ValueError("Lesson id already exists in course-status.json")
            if (lessons_root / lesson_id).exists():
                raise ValueError("Lesson directory already exists")

            pdf_path = pdf_directory / f"{item['pdfStem']}.pdf"
            audio_path = audio_directory / f"{item['audioStem']}.mp3"
            if not pdf_path.is_file():
                raise FileNotFoundError(pdf_path)
            if not audio_path.is_file():
                raise FileNotFoundError(audio_path)

            work_directory.mkdir(parents=True, exist_ok=True)
            audio_analysis = analyze_audio(audio_path)
            extraction = extract_pdf(pdf_path, work_directory / "extraction")
            if extraction["warnings"]:
                raise ValueError(
                    "PDF extraction warnings: "
                    + "; ".join(extraction["warnings"])
                )
            transcript = build_transcript(
                lesson_id=lesson_id,
                title=item["title"],
                audio_analysis=audio_analysis,
                extraction=extraction,
            )
            write_transcript(transcript, transcript_path)

            alignment_directory.mkdir(parents=True, exist_ok=True)
            authoritative_path = (
                alignment_directory / "authoritative-sentences.json"
            )
            whisper_path = alignment_directory / "whisper-words.json"
            alignment_path = alignment_directory / "alignment.json"
            alignment_report_path = (
                alignment_directory / "alignment-report.json"
            )
            alignment_preview_path = (
                alignment_directory / "alignment-preview.txt"
            )

            authoritative = build_authoritative_sentences(transcript_path)
            write_authoritative_sentences(authoritative, authoritative_path)
            if whisper_path.is_file():
                transcription = json.loads(
                    whisper_path.read_text(encoding="utf-8")
                )
                if transcription.get("model") != model_name:
                    raise ValueError(
                        f"Cached Whisper model is "
                        f"{transcription.get('model')}; requested {model_name}"
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
            alignment_validation = validate_alignment(alignment)
            write_report(
                alignment_validation,
                build_preview(alignment, alignment_validation),
                alignment_report_path,
                alignment_preview_path,
            )
            result["alignmentCoverage"] = alignment["coverage"]
            result["alignmentSentenceCount"] = len(alignment["segments"])
            alignment_failures = alignment_failure_reasons(
                alignment,
                alignment_validation,
            )
            if alignment_failures:
                raise ValueError("; ".join(alignment_failures))

            transcript_v2 = build_transcript_v2(
                transcript.model_dump(),
                alignment,
            )
            write_transcript_v2(transcript_v2, transcript_v2_path)
            result["v2Generated"] = True

            candidate_status = {
                "importStatus": "completed",
                "alignmentStatus": "passed",
                "transcriptVersion": 2,
                "reviewStatus": "approved",
                "published": True,
            }
            validation_status_path = work_directory / "validation-status.json"
            write_json_atomic(
                validation_status_path,
                {lesson_id: candidate_status},
            )
            validation_lessons_root = build_validation_lesson(
                lesson_id,
                work_directory=work_directory,
                source_audio=audio_path,
                transcript_path=transcript_path,
                transcript_v2_path=transcript_v2_path,
            )
            publish_validation = validate_publish(
                lesson_id,
                lessons_root=validation_lessons_root,
                staging_root=staging_root,
                status_path=validation_status_path,
            )
            result["publishValidation"] = publish_validation
            if not publish_validation["canPublish"]:
                raise ValueError(
                    "Publish validation failed: "
                    + "; ".join(publish_validation["errors"])
                )

            publish_course_atomically(
                lesson_id,
                lessons_root=lessons_root,
                source_audio=audio_path,
                transcript_path=transcript_path,
                transcript_v2_path=transcript_v2_path,
            )
            statuses[lesson_id] = candidate_status
            write_json_atomic(status_path, statuses)
            result["published"] = True
            print(
                f"[{index:02d}/{len(plan):02d}] PASS {lesson_id}: "
                f"coverage={alignment['coverage']:.1%}, "
                f"sentences={len(alignment['segments'])}",
                flush=True,
            )
        except Exception as error:
            result["failureReasons"].append(str(error))
            print(
                f"[{index:02d}/{len(plan):02d}] FAIL {lesson_id}: {error}",
                flush=True,
            )
        results.append(result)

    report = {
        "model": model_name,
        "testCourses": [
            {
                "lessonId": item["id"],
                "title": item["title"],
                "selectionProfile": item.get("selectionProfile", ""),
            }
            for item in plan
        ],
        "results": results,
        "summary": {
            "testedCount": len(results),
            "successfulCount": sum(result["published"] for result in results),
            "failedCount": sum(not result["published"] for result in results),
            "v2GeneratedCount": sum(
                result["v2Generated"] for result in results
            ),
        },
    }
    write_json_atomic(
        report_path or staging_root / "batch-production-test-report.json",
        report,
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run an isolated 10-course production test."
    )
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--lessons-root", type=Path, default=LESSONS_ROOT)
    parser.add_argument("--staging-root", type=Path, default=STAGING_ROOT)
    parser.add_argument("--status", type=Path, default=COURSE_STATUS_PATH)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    report = run_production_test(
        plan_path=args.plan,
        source_root=args.source_root,
        lessons_root=args.lessons_root,
        staging_root=args.staging_root,
        status_path=args.status,
        report_path=args.report,
        model_name=args.model,
        device=args.device,
        compute_type=args.compute_type,
    )
    print(json.dumps(report["summary"], ensure_ascii=False), flush=True)
    if report["summary"]["failedCount"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
