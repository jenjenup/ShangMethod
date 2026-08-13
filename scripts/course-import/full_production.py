from __future__ import annotations

import argparse
import json
from pathlib import Path

from batch_generate_v2 import load_statuses, write_json_atomic
from batch_production_test import run_production_test
from config import (
    COURSE_STATUS_PATH,
    DEFAULT_SOURCE_ROOT,
    LESSONS_ROOT,
    STAGING_ROOT,
)


DEFAULT_EVALUATION_PATH = STAGING_ROOT / "full-import-evaluation.json"
DEFAULT_FINAL_REPORT_PATH = STAGING_ROOT / "full-production-final-report.json"
DEFAULT_RUN_ROOT = STAGING_ROOT / "full-production"


def load_evaluation(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    records = payload.get("records")
    if not isinstance(records, list):
        raise ValueError("Evaluation report must contain a records array")
    return records


def previously_failed_lesson_ids(staging_root: Path) -> set[str]:
    failed: set[str] = set()
    for report_path in staging_root.glob("*production*report.json"):
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for result in report.get("results", []):
            if result.get("published") is False and result.get("lessonId"):
                failed.add(result["lessonId"])
    return failed


def record_to_plan_item(record: dict) -> dict:
    pdf_name = record["filename"]
    mp3_name = record["pdfMp3Match"]["mp3"]
    audio = record["audioAnalysis"]
    extraction = record["textExtraction"]
    return {
        "id": record["candidateLessonId"],
        "title": Path(pdf_name).stem,
        "pdfStem": Path(pdf_name).stem,
        "audioStem": Path(mp3_name).stem,
        "selectionProfile": (
            f"{audio['durationSeconds']:.1f}s, "
            f"{extraction['pageCount']} pages, "
            f"{record['pdfMp3Match']['status']} filename match"
        ),
    }


def chunked(items: list[dict], size: int) -> list[list[dict]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def build_final_report(
    *,
    ready_count: int,
    published_before: set[str],
    failed_before: set[str],
    batch_reports: list[dict],
) -> dict:
    results = [
        result
        for report in batch_reports
        for result in report.get("results", [])
    ]
    return {
        "readyMaterialCount": ready_count,
        "skippedAlreadyPublishedCount": len(published_before),
        "skippedPreviouslyFailedCount": len(failed_before),
        "totalProcessedCount": len(results),
        "successfulCount": sum(result["published"] for result in results),
        "failedCount": sum(not result["published"] for result in results),
        "results": results,
    }


def run_full_production(
    *,
    evaluation_path: Path = DEFAULT_EVALUATION_PATH,
    final_report_path: Path = DEFAULT_FINAL_REPORT_PATH,
    run_root: Path = DEFAULT_RUN_ROOT,
    source_root: Path = DEFAULT_SOURCE_ROOT,
    lessons_root: Path = LESSONS_ROOT,
    staging_root: Path = STAGING_ROOT,
    status_path: Path = COURSE_STATUS_PATH,
    batch_size: int = 10,
    model_name: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
) -> dict:
    if batch_size < 1:
        raise ValueError("Batch size must be at least 1")

    records = load_evaluation(evaluation_path)
    ready_records = [record for record in records if record.get("ready") is True]
    ready_ids = {record["candidateLessonId"] for record in ready_records}
    published_before = set(load_statuses(status_path)) & ready_ids
    failed_before = previously_failed_lesson_ids(staging_root) & ready_ids
    pending_records = [
        record
        for record in ready_records
        if record["candidateLessonId"] not in published_before
        and record["candidateLessonId"] not in failed_before
    ]
    pending_records.sort(
        key=lambda record: (
            record["audioAnalysis"]["durationSeconds"],
            record["candidateLessonId"],
        )
    )

    run_root.mkdir(parents=True, exist_ok=True)
    batches = chunked(
        [record_to_plan_item(record) for record in pending_records],
        batch_size,
    )
    batch_reports: list[dict] = []

    for index, batch in enumerate(batches, start=1):
        batch_directory = run_root / f"batch-{index:02d}"
        batch_directory.mkdir(parents=True, exist_ok=True)
        plan_path = batch_directory / "plan.json"
        report_path = batch_directory / "report.json"
        write_json_atomic(plan_path, batch)
        print(
            f"FULL PRODUCTION BATCH {index:02d}/{len(batches):02d}: "
            f"{len(batch)} lessons",
            flush=True,
        )
        report = run_production_test(
            plan_path=plan_path,
            source_root=source_root,
            lessons_root=lessons_root,
            staging_root=staging_root,
            status_path=status_path,
            report_path=report_path,
            model_name=model_name,
            device=device,
            compute_type=compute_type,
        )
        batch_reports.append(report)
        final_report = build_final_report(
            ready_count=len(ready_records),
            published_before=published_before,
            failed_before=failed_before,
            batch_reports=batch_reports,
        )
        write_json_atomic(final_report_path, final_report)
        print(
            f"BATCH {index:02d} SAVED: "
            f"success={report['summary']['successfulCount']}, "
            f"failed={report['summary']['failedCount']}",
            flush=True,
        )

    final_report = build_final_report(
        ready_count=len(ready_records),
        published_before=published_before,
        failed_before=failed_before,
        batch_reports=batch_reports,
    )
    write_json_atomic(final_report_path, final_report)
    return final_report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Produce every remaining ready course in isolated batches."
    )
    parser.add_argument("--evaluation", type=Path, default=DEFAULT_EVALUATION_PATH)
    parser.add_argument("--final-report", type=Path, default=DEFAULT_FINAL_REPORT_PATH)
    parser.add_argument("--run-root", type=Path, default=DEFAULT_RUN_ROOT)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--lessons-root", type=Path, default=LESSONS_ROOT)
    parser.add_argument("--staging-root", type=Path, default=STAGING_ROOT)
    parser.add_argument("--status", type=Path, default=COURSE_STATUS_PATH)
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    report = run_full_production(
        evaluation_path=args.evaluation,
        final_report_path=args.final_report,
        run_root=args.run_root,
        source_root=args.source_root,
        lessons_root=args.lessons_root,
        staging_root=args.staging_root,
        status_path=args.status,
        batch_size=args.batch_size,
        model_name=args.model,
        device=args.device,
        compute_type=args.compute_type,
    )
    print(
        json.dumps(
            {
                "totalProcessedCount": report["totalProcessedCount"],
                "successfulCount": report["successfulCount"],
                "failedCount": report["failedCount"],
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
