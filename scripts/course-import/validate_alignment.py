from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


def validate_alignment(alignment: dict) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    duration = float(alignment["audioDurationSeconds"])
    segments = alignment["segments"]
    previous_start = -1.0
    previous_end = -1.0
    unmatched_ids: list[int] = []
    overlapping_ids: list[int] = []

    for segment in segments:
        start = float(segment["start"])
        end = float(segment["end"])
        sentence_id = int(segment["id"])
        if segment["estimated"] or end <= start:
            unmatched_ids.append(sentence_id)
            continue
        if start < previous_start:
            errors.append(f"Sentence {sentence_id} starts before the prior sentence")
        if end > duration + 0.5:
            errors.append(f"Sentence {sentence_id} exceeds audio duration")
        if previous_end >= 0 and start < previous_end:
            overlapping_ids.append(sentence_id)
        previous_start = start
        previous_end = max(previous_end, end)

    confidence_counts = Counter(
        segment["confidence"] for segment in segments
    )
    low_coverage_ids = [
        int(segment["id"])
        for segment in segments
        if float(segment["matchCoverage"]) < 0.6
    ]
    if unmatched_ids:
        warnings.append(f"{len(unmatched_ids)} sentences have no reliable timestamp")
    if overlapping_ids:
        warnings.append(f"{len(overlapping_ids)} sentence ranges overlap")
    if low_coverage_ids:
        warnings.append(f"{len(low_coverage_ids)} sentences have under 60% coverage")
    if float(alignment["coverage"]) < 0.75:
        warnings.append("Overall authoritative token coverage is under 75%")

    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "sentenceCount": len(segments),
            "overallCoverage": alignment["coverage"],
            "matchedTokenCount": alignment["matchedTokenCount"],
            "authoritativeTokenCount": alignment["authoritativeTokenCount"],
            "recognizedWordCount": alignment["recognizedWordCount"],
            "confidenceCounts": dict(confidence_counts),
            "unmatchedSentenceIds": unmatched_ids,
            "lowCoverageSentenceIds": low_coverage_ids,
            "overlappingSentenceIds": overlapping_ids,
        },
    }


def build_preview(alignment: dict, report: dict) -> str:
    stats = report["stats"]
    lines = [
        f"Lesson: {alignment['lessonId']}",
        f"Model: {alignment['model']}",
        f"Audio duration: {alignment['audioDurationSeconds']:.2f}s",
        f"Sentences: {stats['sentenceCount']}",
        f"Overall coverage: {stats['overallCoverage']:.1%}",
        f"Confidence: {stats['confidenceCounts']}",
        f"Unmatched sentences: {stats['unmatchedSentenceIds']}",
        f"Low coverage sentences: {stats['lowCoverageSentenceIds']}",
        "",
        "TIMELINE",
        "========",
    ]
    for segment in alignment["segments"]:
        lines.extend(
            [
                (
                    f"[{segment['id']:03d}] {segment['start']:8.3f} → "
                    f"{segment['end']:8.3f}  {segment['confidence'].upper():6s}  "
                    f"coverage={segment['matchCoverage']:.1%}"
                ),
                segment["english"],
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def write_report(
    report: dict,
    preview: str,
    report_path: Path,
    preview_path: Path,
) -> None:
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    preview_path.write_text(preview, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate an alignment report.")
    parser.add_argument("alignment", type=Path)
    parser.add_argument("report", type=Path)
    parser.add_argument("preview", type=Path)
    args = parser.parse_args()
    alignment = json.loads(args.alignment.read_text(encoding="utf-8"))
    report = validate_alignment(alignment)
    write_report(
        report,
        build_preview(alignment, report),
        args.report,
        args.preview,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["valid"] else 1)


if __name__ == "__main__":
    main()
