from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

import pdfplumber
from PIL import ImageDraw

from config import MAIN_COLUMN_RIGHT_RATIO


CJK_PATTERN = re.compile(r"[\u3400-\u9fff]")
LATIN_PATTERN = re.compile(r"[A-Za-z]")
CID_PATTERN = re.compile(r"\(cid:\d+\)")
HEADER_PATTERNS = (
    re.compile(r"^TED(?:演讲)?$", re.IGNORECASE),
    re.compile(r"^NYU$", re.IGNORECASE),
    re.compile(r"^题目[：:]"),
    re.compile(r"^作者[：:]"),
    re.compile(r"commencement speech", re.IGNORECASE),
    re.compile(r"read the full transcript", re.IGNORECASE),
)


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = value.replace("\u00ad", "").replace("\u200b", "")
    return re.sub(r"\s+", " ", value).strip()


def classify_language(value: str) -> str:
    chinese_count = len(CJK_PATTERN.findall(value))
    latin_count = len(LATIN_PATTERN.findall(value))
    if chinese_count >= 2 and chinese_count >= latin_count * 0.25:
        return "zh"
    if latin_count >= 3:
        return "en"
    return "other"


def clean_line(value: str, language: str) -> str:
    value = normalize_text(value)
    if language == "zh":
        previous = None
        while previous != value:
            previous = value
            value = re.sub(
                r"([\u3400-\u9fff，。！？；：“”‘’、])\s+"
                r"(?=[\u3400-\u9fff，。！？；：“”‘’、])",
                r"\1",
                value,
            )
    else:
        value = re.sub(r"\s+([,.;:!?%])", r"\1", value)
        value = re.sub(r"([“‘(\"'])\s+", r"\1", value)
    return value.strip()


def group_lines(words: list[dict]) -> list[dict]:
    lines: list[dict] = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        line = next(
            (
                candidate
                for candidate in reversed(lines[-4:])
                if abs(candidate["top"] - word["top"]) <= 2.2
            ),
            None,
        )
        if line is None:
            line = {"top": float(word["top"]), "words": []}
            lines.append(line)
        line["words"].append(word)

    grouped: list[dict] = []
    for line in lines:
        sorted_words = sorted(line["words"], key=lambda item: item["x0"])
        raw_text = " ".join(word["text"] for word in sorted_words)
        normalized = normalize_text(raw_text)
        language = classify_language(normalized)
        grouped.append(
            {
                "top": round(line["top"], 2),
                "bottom": round(max(float(word["bottom"]) for word in sorted_words), 2),
                "maxSize": round(max(float(word.get("size", 0)) for word in sorted_words), 2),
                "language": language,
                "text": clean_line(normalized, language),
            }
        )
    return grouped


def is_header_line(line: dict) -> bool:
    return any(pattern.search(line["text"]) for pattern in HEADER_PATTERNS)


def find_first_page_body_start(lines: list[dict], page_height: float) -> float:
    minimum_top = page_height * 0.11
    for line in lines:
        if (
            line["top"] >= minimum_top
            and line["language"] == "en"
            and 5 <= len(line["text"])
            and line["maxSize"] <= 16
            and not is_header_line(line)
            and not CID_PATTERN.search(line["text"])
        ):
            return float(line["top"]) - 1
    return minimum_top


def lines_to_blocks(lines: list[dict]) -> list[dict]:
    blocks: list[dict] = []
    for line in lines:
        if line["language"] not in {"en", "zh"} or not line["text"]:
            continue
        if blocks and blocks[-1]["language"] == line["language"]:
            blocks[-1]["lines"].append(line["text"])
            blocks[-1]["bottom"] = line["bottom"]
        else:
            blocks.append(
                {
                    "language": line["language"],
                    "top": line["top"],
                    "bottom": line["bottom"],
                    "lines": [line["text"]],
                }
            )

    for block in blocks:
        separator = "" if block["language"] == "zh" else " "
        block["text"] = separator.join(block.pop("lines")).strip()
    return blocks


def merge_document_blocks(page_blocks: list[list[dict]]) -> list[dict]:
    merged: list[dict] = []
    for page_number, blocks in enumerate(page_blocks, start=1):
        for block in blocks:
            item = {
                "language": block["language"],
                "pageStart": page_number,
                "pageEnd": page_number,
                "text": block["text"],
            }
            if merged and merged[-1]["language"] == item["language"]:
                separator = "" if item["language"] == "zh" else " "
                merged[-1]["text"] += separator + item["text"]
                merged[-1]["pageEnd"] = page_number
            else:
                merged.append(item)
    return merged


def save_debug_image(page, output_path: Path, cutoff_x: float) -> None:
    page_image = page.to_image(resolution=110)
    image = page_image.original.copy()
    scale = image.width / page.width
    draw = ImageDraw.Draw(image)
    x = round(cutoff_x * scale)
    draw.line((x, 0, x, image.height), fill=(220, 30, 30), width=3)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


def extract_pdf(pdf_path: Path, output_directory: Path) -> dict:
    output_directory.mkdir(parents=True, exist_ok=True)
    page_debug: list[dict] = []
    page_blocks: list[list[dict]] = []

    with pdfplumber.open(pdf_path) as document:
        for page_index, page in enumerate(document.pages):
            cutoff_x = page.width * MAIN_COLUMN_RIGHT_RATIO
            words = page.extract_words(extra_attrs=["size", "fontname"]) or []
            main_words = [word for word in words if float(word["x0"]) < cutoff_x]
            filtered_words = [word for word in words if float(word["x0"]) >= cutoff_x]
            lines = group_lines(main_words)
            body_start = (
                find_first_page_body_start(lines, page.height)
                if page_index == 0
                else 0
            )
            kept_lines = [
                line
                for line in lines
                if line["top"] >= body_start
                and not is_header_line(line)
                and not (
                    line["bottom"] > page.height - 18
                    and re.fullmatch(r"[-–—]?\d+[-–—]?", line["text"])
                )
            ]
            blocks = lines_to_blocks(kept_lines)
            page_blocks.append(blocks)

            filtered_sample = normalize_text(
                " ".join(word["text"] for word in filtered_words[:80])
            )
            debug = {
                "page": page_index + 1,
                "width": round(float(page.width), 2),
                "height": round(float(page.height), 2),
                "mainColumnCutoffX": round(float(cutoff_x), 2),
                "bodyStartY": round(float(body_start), 2),
                "rawWordCount": len(words),
                "mainWordCount": len(main_words),
                "rightFilteredWordCount": len(filtered_words),
                "rawCidCount": len(CID_PATTERN.findall(page.extract_text() or "")),
                "keptCidCount": sum(
                    len(CID_PATTERN.findall(block["text"])) for block in blocks
                ),
                "blockLanguages": [block["language"] for block in blocks],
                "filteredRightSample": filtered_sample[:500],
            }
            page_debug.append(debug)

            if page_index == 0:
                save_debug_image(
                    page,
                    output_directory / "debug-page-1.png",
                    cutoff_x,
                )

    merged_blocks = merge_document_blocks(page_blocks)
    english_blocks = [block["text"] for block in merged_blocks if block["language"] == "en"]
    chinese_blocks = [block["text"] for block in merged_blocks if block["language"] == "zh"]
    english = "\n\n".join(english_blocks).strip()
    chinese = "\n\n".join(chinese_blocks).strip()
    warnings: list[str] = []
    kept_cid_count = len(CID_PATTERN.findall(english + chinese))
    if kept_cid_count:
        warnings.append(f"Detected {kept_cid_count} retained CID markers")
    if not english:
        warnings.append("English extraction is empty")
    if not chinese:
        warnings.append("Chinese extraction is empty")

    result = {
        "sourcePdf": str(pdf_path),
        "layout": {
            "mode": "vertical-bilingual-with-right-vocabulary",
            "mainColumnRightRatio": MAIN_COLUMN_RIGHT_RATIO,
        },
        "pageCount": len(page_debug),
        "english": english,
        "chinese": chinese,
        "documentBlocks": merged_blocks,
        "pageDebug": page_debug,
        "warnings": warnings,
    }

    (output_directory / "extracted.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    preview_parts = [
        f"SOURCE: {pdf_path}",
        f"PAGES: {len(page_debug)}",
        f"CROP RATIO: {MAIN_COLUMN_RIGHT_RATIO}",
        f"WARNINGS: {warnings or 'none'}",
        "",
        "===== ENGLISH =====",
        english,
        "",
        "===== CHINESE =====",
        chinese,
        "",
        "===== PAGE DEBUG =====",
        json.dumps(page_debug, ensure_ascii=False, indent=2),
    ]
    (output_directory / "extracted_preview.txt").write_text(
        "\n".join(preview_parts) + "\n",
        encoding="utf-8",
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract bilingual PDF text.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    result = extract_pdf(args.pdf, args.output_directory)
    print(
        f"English: {len(result['english'])} chars, "
        f"Chinese: {len(result['chinese'])} chars"
    )
    print(f"Warnings: {result['warnings'] or 'none'}")


if __name__ == "__main__":
    main()
