from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from pathlib import Path

from rapidfuzz import fuzz

from config import (
    DEFAULT_SOURCE_ROOT,
    FUZZY_LOW_THRESHOLD,
    FUZZY_REVIEW_THRESHOLD,
    REPORTS_ROOT,
    source_directories,
)


def normalize_stem(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    return re.sub(r"[\W_]+", "", value)


def match_materials(source_root: Path) -> dict:
    pdf_directory, audio_directory = source_directories(source_root)
    pdf_files = sorted(pdf_directory.glob("*.pdf"))
    audio_files = sorted(audio_directory.glob("*.mp3"))
    available_audio = set(audio_files)
    matches: list[dict] = []

    for pdf_path in pdf_files:
        normalized_pdf = normalize_stem(pdf_path.stem)
        exact = next(
            (
                audio_path
                for audio_path in available_audio
                if normalize_stem(audio_path.stem) == normalized_pdf
            ),
            None,
        )
        if exact:
            selected = exact
            score = 100.0
            status = "exact"
        else:
            ranked = sorted(
                (
                    (
                        fuzz.ratio(normalized_pdf, normalize_stem(audio_path.stem)),
                        audio_path,
                    )
                    for audio_path in available_audio
                ),
                reverse=True,
                key=lambda item: item[0],
            )
            score, selected = ranked[0]
            if score >= FUZZY_REVIEW_THRESHOLD:
                status = "fuzzy"
            elif score >= FUZZY_LOW_THRESHOLD:
                status = "needs-review"
            else:
                status = "low-similarity"

        available_audio.remove(selected)
        matches.append(
            {
                "pdf": pdf_path.name,
                "audio": selected.name,
                "score": round(float(score), 2),
                "status": status,
            }
        )

    return {
        "sourceRoot": str(source_root),
        "pdfCount": len(pdf_files),
        "mp3Count": len(audio_files),
        "matches": matches,
        "extraAudio": [path.name for path in sorted(available_audio)],
        "summary": {
            status: sum(match["status"] == status for match in matches)
            for status in ("exact", "fuzzy", "needs-review", "low-similarity")
        },
    }


def write_reports(report: dict, output_json: Path, output_csv: Path) -> None:
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    with output_csv.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=("pdf", "audio", "score", "status"),
        )
        writer.writeheader()
        writer.writerows(report["matches"])


def main() -> None:
    parser = argparse.ArgumentParser(description="Match PDFs to MP3 files.")
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument(
        "--output-json",
        type=Path,
        default=REPORTS_ROOT / "matches.json",
    )
    parser.add_argument(
        "--output-csv",
        type=Path,
        default=REPORTS_ROOT / "matches.csv",
    )
    args = parser.parse_args()
    report = match_materials(args.source_root)
    write_reports(report, args.output_json, args.output_csv)
    print(json.dumps(report["summary"], ensure_ascii=False))
    print(f"Extra MP3 files: {len(report['extraAudio'])}")
    print(f"Match reports: {args.output_json}, {args.output_csv}")


if __name__ == "__main__":
    main()
