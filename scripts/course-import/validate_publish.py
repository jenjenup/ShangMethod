from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

from config import COURSE_STATUS_PATH, LESSONS_ROOT, STAGING_ROOT
from models import CourseStatus, Transcript


CID_PATTERN = re.compile(r"\(cid:\d+\)", re.IGNORECASE)
LONG_LATIN_PATTERN = re.compile(r"\b[A-Za-z]{40,}\b")
REPEATED_CHARACTER_PATTERN = re.compile(r"(.)\1{14,}")
HEADER_FOOTER_PATTERNS = (
    re.compile(r"\bTED(?:\.com|\s+Talks?)\b", re.IGNORECASE),
    re.compile(r"\bpage\s+\d+\s+(?:of\s+\d+)?\b", re.IGNORECASE),
    re.compile(r"(?:^|\n)\s*第?\s*\d+\s*页\s*(?:\n|$)"),
)
VOCABULARY_PATTERNS = (
    re.compile(
        r"(?:^|\s)(?:adj|adv|prep|pron|conj|n|v)\.\s*[\u3400-\u9fff]",
        re.IGNORECASE,
    ),
    re.compile(r"/[^/\n]{2,30}/\s*[\u3400-\u9fff]"),
)


def load_json(path: Path, errors: list[str], label: str) -> dict | None:
    if not path.is_file():
        errors.append(f"Missing {label}: {path}")
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        errors.append(f"Invalid {label} JSON: {error}")
        return None
    if not isinstance(value, dict):
        errors.append(f"{label} must contain an object")
        return None
    return value


def inspect_text_quality(
    transcript: Transcript,
    warnings: list[str],
    errors: list[str],
) -> None:
    english = "\n".join(sentence.english for sentence in transcript.sentences)
    chinese = transcript.translation
    combined = english + "\n" + chinese

    cid_count = len(CID_PATTERN.findall(combined))
    if cid_count:
        warnings.append(f"Detected {cid_count} CID markers")
    long_tokens = LONG_LATIN_PATTERN.findall(combined)
    if long_tokens:
        warnings.append(
            f"Detected {len(long_tokens)} unusually long Latin tokens"
        )
    repeated = REPEATED_CHARACTER_PATTERN.findall(combined)
    if repeated:
        warnings.append(
            f"Detected {len(repeated)} abnormal repeated-character sequences"
        )
    replacement_count = combined.count("\ufffd")
    if replacement_count:
        errors.append(f"Detected {replacement_count} replacement characters")
    control_count = sum(
        1
        for character in combined
        if unicodedata.category(character) == "Cc"
        and character not in {"\n", "\r", "\t"}
    )
    if control_count:
        errors.append(f"Detected {control_count} unexpected control characters")

    for pattern in HEADER_FOOTER_PATTERNS:
        matches = pattern.findall(combined)
        if matches:
            warnings.append(
                f"Possible PDF header/footer residue: {len(matches)} matches"
            )
    for pattern in VOCABULARY_PATTERNS:
        matches = pattern.findall(combined)
        if matches:
            warnings.append(
                f"Possible vocabulary-column residue: {len(matches)} matches"
            )

    empty_sentence_chinese = sum(
        not sentence.chinese.strip() for sentence in transcript.sentences
    )
    if empty_sentence_chinese:
        warnings.append(
            f"{empty_sentence_chinese} sentence-level Chinese values are empty; "
            "top-level translation is preserved"
        )


def inspect_timeline(
    transcript: Transcript,
    errors: list[str],
) -> None:
    previous_end = -1.0
    for sentence in transcript.sentences:
        if not sentence.english.strip():
            errors.append(f"Sentence {sentence.id} has empty English")
        if sentence.start < previous_end:
            errors.append(f"Sentence {sentence.id} overlaps the prior sentence")
        if sentence.end > transcript.durationSeconds + 0.5:
            errors.append(f"Sentence {sentence.id} exceeds audio duration")
        previous_end = sentence.end


def inspect_alignment(
    lesson_id: str,
    report: dict | None,
    alignment: dict | None,
    errors: list[str],
) -> None:
    if report is None or alignment is None:
        return
    if alignment.get("lessonId") != lesson_id:
        errors.append("Alignment lesson id does not match")
    coverage = float(
        report.get("stats", {}).get(
            "overallCoverage",
            alignment.get("coverage", 0),
        )
    )
    if coverage < 0.9:
        errors.append(f"Alignment coverage is below 90%: {coverage:.1%}")
    unmatched = report.get("stats", {}).get("unmatchedSentenceIds", [])
    if unmatched:
        errors.append(f"Alignment has {len(unmatched)} unmatched sentences")
    if any(segment.get("estimated") for segment in alignment.get("segments", [])):
        errors.append("Alignment contains estimated timestamps")
    if report.get("errors"):
        errors.extend(f"Alignment: {value}" for value in report["errors"])


def validate_publish(
    lesson_id: str,
    *,
    lessons_root: Path = LESSONS_ROOT,
    staging_root: Path = STAGING_ROOT,
    status_path: Path = COURSE_STATUS_PATH,
) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    checks: dict[str, bool] = {}

    status_data = load_json(status_path, errors, "course status")
    raw_status = status_data.get(lesson_id) if status_data else None
    if raw_status is None:
        errors.append(f"Lesson is missing from course status: {lesson_id}")
        status = None
    else:
        try:
            status = CourseStatus.model_validate(raw_status)
        except Exception as error:
            errors.append(f"Invalid course status: {error}")
            status = None

    lesson_directory = lessons_root / lesson_id
    v1_path = lesson_directory / "transcript.json"
    audio_path = lesson_directory / "audio.mp3"
    v1_data = load_json(v1_path, errors, "transcript.json")
    checks["transcriptExists"] = v1_data is not None
    checks["audioExists"] = audio_path.is_file()
    if not audio_path.is_file():
        errors.append(f"Missing audio.mp3: {audio_path}")

    transcript_version = status.transcriptVersion if status else 1
    selected_path = (
        lesson_directory / "transcript-v2.json"
        if transcript_version == 2
        else v1_path
    )
    selected_data = (
        load_json(selected_path, errors, selected_path.name)
        if selected_path != v1_path
        else v1_data
    )
    transcript = None
    if selected_data is not None:
        try:
            transcript = Transcript.model_validate(selected_data)
        except Exception as error:
            errors.append(f"Invalid {selected_path.name} structure: {error}")

    if v1_data is not None and v1_data.get("id") != lesson_id:
        errors.append("transcript.json lesson id does not match folder")
    if transcript is not None and transcript.id != lesson_id:
        errors.append(f"{selected_path.name} lesson id does not match folder")

    if transcript is not None:
        inspect_timeline(transcript, errors)
        inspect_text_quality(transcript, warnings, errors)
        checks["transcriptStructure"] = True
        checks["timeline"] = not any(
            "Sentence" in error or "audio duration" in error
            for error in errors
        )
    else:
        checks["transcriptStructure"] = False
        checks["timeline"] = False

    if transcript_version == 2:
        alignment_directory = staging_root / lesson_id / "alignment"
        report = load_json(
            alignment_directory / "alignment-report.json",
            errors,
            "alignment-report.json",
        )
        alignment = load_json(
            alignment_directory / "alignment.json",
            errors,
            "alignment.json",
        )
        inspect_alignment(lesson_id, report, alignment, errors)
        checks["alignment"] = report is not None and alignment is not None
    else:
        checks["alignment"] = True

    if status is not None:
        if status.importStatus != "completed":
            errors.append("importStatus must be completed")
        if transcript_version == 2 and status.alignmentStatus != "passed":
            errors.append("Version 2 requires alignmentStatus=passed")
        if status.reviewStatus != "approved":
            errors.append("reviewStatus must be approved")
        if not status.published:
            errors.append("published must be true")
        checks["statusEligible"] = (
            status.importStatus == "completed"
            and status.reviewStatus == "approved"
            and status.published
            and (
                transcript_version == 1
                or status.alignmentStatus == "passed"
            )
        )
    else:
        checks["statusEligible"] = False

    return {
        "lessonId": lesson_id,
        "transcriptVersion": transcript_version,
        "selectedTranscript": str(selected_path),
        "canPublish": not errors,
        "errors": errors,
        "warnings": list(dict.fromkeys(warnings)),
        "checks": checks,
    }


def write_report(report: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a lesson for publishing.")
    parser.add_argument("lesson_id", nargs="?")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--lessons-root", type=Path, default=LESSONS_ROOT)
    parser.add_argument("--staging-root", type=Path, default=STAGING_ROOT)
    parser.add_argument("--status", type=Path, default=COURSE_STATUS_PATH)
    args = parser.parse_args()
    if bool(args.lesson_id) == bool(args.all):
        parser.error("Provide one lesson_id or --all")

    if args.all:
        status_data = json.loads(args.status.read_text(encoding="utf-8"))
        lesson_ids = list(status_data)
    else:
        lesson_ids = [args.lesson_id]

    reports = []
    for lesson_id in lesson_ids:
        report = validate_publish(
            lesson_id,
            lessons_root=args.lessons_root,
            staging_root=args.staging_root,
            status_path=args.status,
        )
        write_report(
            report,
            args.staging_root / lesson_id / "publish-report.json",
        )
        reports.append(report)
        print(
            f"- {lesson_id}: canPublish={report['canPublish']}, "
            f"errors={len(report['errors'])}, "
            f"warnings={len(report['warnings'])}"
        )
    if any(not report["canPublish"] for report in reports):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
