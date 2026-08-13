from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from config import DEFAULT_SOURCE_ROOT, REPORTS_ROOT, source_directories


def scan_inventory(source_root: Path) -> dict:
    pdf_directory, audio_directory = source_directories(source_root)
    pdf_files = sorted(pdf_directory.glob("*.pdf"))
    audio_files = sorted(audio_directory.glob("*.mp3"))
    all_files = [path for path in source_root.rglob("*") if path.is_file()]
    extension_counts = Counter(path.suffix.lower() or "<none>" for path in all_files)

    return {
        "sourceRoot": str(source_root),
        "pdfDirectory": str(pdf_directory),
        "audioDirectory": str(audio_directory),
        "pdfCount": len(pdf_files),
        "mp3Count": len(audio_files),
        "videoCount": sum(
            extension_counts.get(extension, 0)
            for extension in (".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v")
        ),
        "extensionCounts": dict(sorted(extension_counts.items())),
        "pdfFiles": [path.name for path in pdf_files],
        "mp3Files": [path.name for path in audio_files],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan course source materials.")
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument(
        "--output",
        type=Path,
        default=REPORTS_ROOT / "inventory.json",
    )
    args = parser.parse_args()

    inventory = scan_inventory(args.source_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"PDF: {inventory['pdfCount']}, MP3: {inventory['mp3Count']}, "
        f"video: {inventory['videoCount']}"
    )
    print(f"Inventory report: {args.output}")


if __name__ == "__main__":
    main()
