from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
import unicodedata
from pathlib import Path

from analyze_audio import analyze_audio
from config import DEFAULT_SOURCE_ROOT, STAGING_ROOT, source_directories
from extract_pdf import CID_PATTERN, extract_pdf
from match_materials import match_materials
from text_normalization import split_sentences, tokenize


REPLACEMENT_PATTERN = re.compile(r"\ufffd")
LONG_LATIN_PATTERN = re.compile(r"\b[A-Za-z]{35,}\b")
REPEATED_CHARACTER_PATTERN = re.compile(r"(.)\1{12,}")
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


def candidate_lesson_id(stem: str) -> str:
    normalized = unicodedata.normalize("NFKC", stem).lower()
    latin_words = re.findall(r"[a-z0-9]+", normalized)
    digest = hashlib.sha1(stem.encode("utf-8")).hexdigest()[:8]
    if latin_words:
        slug = "-".join(latin_words)[:48].strip("-")
        return f"ted-{slug}-{digest}"
    return f"ted-course-{digest}"


def inspect_garbled_text(english: str, chinese: str) -> dict:
    combined = english + "\n" + chinese
    cid_count = len(CID_PATTERN.findall(combined))
    replacement_count = len(REPLACEMENT_PATTERN.findall(combined))
    long_latin_count = len(LONG_LATIN_PATTERN.findall(combined))
    repeated_count = len(REPEATED_CHARACTER_PATTERN.findall(combined))
    control_count = sum(
        1
        for character in combined
        if unicodedata.category(character) == "Cc"
        and character not in {"\n", "\r", "\t"}
    )
    header_footer_count = sum(
        len(pattern.findall(combined)) for pattern in HEADER_FOOTER_PATTERNS
    )
    vocabulary_residue_count = sum(
        len(pattern.findall(combined)) for pattern in VOCABULARY_PATTERNS
    )
    passed = not any(
        (
            cid_count,
            replacement_count,
            long_latin_count,
            repeated_count,
            control_count,
            header_footer_count,
            vocabulary_residue_count,
        )
    )
    return {
        "passed": passed,
        "cidCount": cid_count,
        "replacementCharacterCount": replacement_count,
        "longLatinTokenCount": long_latin_count,
        "repeatedCharacterSequenceCount": repeated_count,
        "unexpectedControlCharacterCount": control_count,
        "headerFooterResidueCount": header_footer_count,
        "vocabularyResidueCount": vocabulary_residue_count,
    }


def text_reject_reasons(
    extraction: dict,
    garbled: dict,
) -> tuple[list[str], dict]:
    english = extraction["english"].strip()
    chinese = extraction["chinese"].strip()
    english_tokens = tokenize(english)
    chinese_characters = len(re.findall(r"[\u3400-\u9fff]", chinese))
    sentences = split_sentences(english)
    longest_sentence_words = max(
        (len(tokenize(sentence)) for sentence in sentences),
        default=0,
    )
    reasons: list[str] = []

    if not english or len(english_tokens) < 50:
        reasons.append("English body is missing or too short")
    if not chinese or chinese_characters < 100:
        reasons.append("Chinese translation is missing or too short")
    if extraction.get("warnings"):
        reasons.extend(str(warning) for warning in extraction["warnings"])
    if garbled["cidCount"]:
        reasons.append(f"Detected {garbled['cidCount']} retained CID markers")
    if garbled["replacementCharacterCount"]:
        reasons.append("Detected Unicode replacement characters")
    if garbled["longLatinTokenCount"]:
        reasons.append(
            f"Detected {garbled['longLatinTokenCount']} abnormal long Latin tokens"
        )
    if garbled["repeatedCharacterSequenceCount"]:
        reasons.append("Detected abnormal repeated-character sequences")
    if garbled["unexpectedControlCharacterCount"]:
        reasons.append("Detected unexpected control characters")
    if garbled["headerFooterResidueCount"]:
        reasons.append("Detected possible PDF header/footer residue")
    if garbled["vocabularyResidueCount"]:
        reasons.append("Detected possible right-column vocabulary residue")
    if not sentences:
        reasons.append("English sentence splitting produced no sentences")
    if longest_sentence_words > 160:
        reasons.append(
            f"Longest English sentence is too large: {longest_sentence_words} words"
        )
    if english_tokens:
        translation_ratio = chinese_characters / len(english_tokens)
        if translation_ratio < 0.45 or translation_ratio > 3.5:
            reasons.append(
                f"English/Chinese length ratio is abnormal: {translation_ratio:.2f}"
            )
    else:
        translation_ratio = 0.0

    return list(dict.fromkeys(reasons)), {
        "success": bool(english and chinese),
        "pageCount": extraction.get("pageCount", 0),
        "englishCharacters": len(english),
        "englishWordCount": len(english_tokens),
        "chineseCharacters": chinese_characters,
        "sentenceCount": len(sentences),
        "longestSentenceWords": longest_sentence_words,
        "translationRatio": round(translation_ratio, 3),
        "warnings": extraction.get("warnings", []),
    }


def alignment_prediction(
    *,
    text_result: dict,
    audio_result: dict | None,
    upstream_reasons: list[str],
) -> dict:
    reasons: list[str] = []
    duration_seconds = (
        float(audio_result["durationSeconds"]) if audio_result else 0.0
    )
    words = int(text_result["englishWordCount"])
    words_per_minute = (
        words / (duration_seconds / 60) if duration_seconds > 0 else 0.0
    )
    if duration_seconds <= 0:
        reasons.append("Audio duration is unavailable")
    elif words_per_minute < 70 or words_per_minute > 230:
        reasons.append(
            f"Predicted speech rate is outside 70-230 WPM: "
            f"{words_per_minute:.1f}"
        )
    if text_result["sentenceCount"] < 3:
        reasons.append("Too few English sentences for sentence-level alignment")
    if upstream_reasons:
        reasons.append("Upstream matching or text quality is not fully automatic")

    return {
        "result": "likely" if not reasons else "rejected",
        "predictedWordsPerMinute": round(words_per_minute, 2),
        "sentenceCount": text_result["sentenceCount"],
        "reasons": reasons,
        "method": "heuristic-no-whisper-run",
    }


def evaluate_full_import(
    source_root: Path,
    output_path: Path,
) -> dict:
    pdf_directory, audio_directory = source_directories(source_root)
    matching = match_materials(source_root)
    records: list[dict] = []

    with tempfile.TemporaryDirectory(prefix="shangmethod-full-evaluation-") as temp:
        temp_root = Path(temp)
        for index, match in enumerate(matching["matches"], start=1):
            pdf_path = pdf_directory / match["pdf"]
            audio_path = audio_directory / match["audio"]
            reject_reasons: list[str] = []
            matching_automatic = match["status"] in {"exact", "fuzzy"}
            if not matching_automatic:
                reject_reasons.append(
                    f"PDF/MP3 match requires review: {match['status']} "
                    f"({match['score']:.2f})"
                )

            extraction = None
            extraction_error = None
            text_result = {
                "success": False,
                "pageCount": 0,
                "englishCharacters": 0,
                "englishWordCount": 0,
                "chineseCharacters": 0,
                "sentenceCount": 0,
                "longestSentenceWords": 0,
                "translationRatio": 0.0,
                "warnings": [],
            }
            garbled = inspect_garbled_text("", "")
            try:
                extraction = extract_pdf(
                    pdf_path,
                    temp_root / f"{index:03d}",
                )
                garbled = inspect_garbled_text(
                    extraction["english"],
                    extraction["chinese"],
                )
                text_reasons, text_result = text_reject_reasons(
                    extraction,
                    garbled,
                )
                reject_reasons.extend(text_reasons)
            except Exception as error:
                extraction_error = str(error)
                reject_reasons.append(f"PDF extraction failed: {error}")

            audio_result = None
            audio_error = None
            try:
                audio_result = analyze_audio(audio_path)
            except Exception as error:
                audio_error = str(error)
                reject_reasons.append(f"Audio analysis failed: {error}")

            upstream_reasons = list(reject_reasons)
            predicted_alignment = alignment_prediction(
                text_result=text_result,
                audio_result=audio_result,
                upstream_reasons=upstream_reasons,
            )
            reject_reasons.extend(predicted_alignment["reasons"])
            reject_reasons = list(dict.fromkeys(reject_reasons))
            ready = not reject_reasons

            records.append(
                {
                    "filename": pdf_path.name,
                    "candidateLessonId": candidate_lesson_id(pdf_path.stem),
                    "pdfMp3Match": {
                        "matched": audio_path.is_file(),
                        "pdf": pdf_path.name,
                        "mp3": audio_path.name,
                        "score": match["score"],
                        "status": match["status"],
                        "automatic": matching_automatic,
                    },
                    "textExtraction": {
                        **text_result,
                        "error": extraction_error,
                    },
                    "garbledText": garbled,
                    "audioAnalysis": (
                        {
                            "success": True,
                            **audio_result,
                        }
                        if audio_result
                        else {
                            "success": False,
                            "error": audio_error,
                        }
                    ),
                    "alignmentPrediction": predicted_alignment,
                    "ready": ready,
                    "rejectReasons": reject_reasons,
                }
            )
            print(
                f"[{index:03d}/{len(matching['matches']):03d}] "
                f"{'ready' if ready else 'rejected'}: {pdf_path.stem}"
            )

        for audio_name in matching["extraAudio"]:
            audio_path = audio_directory / audio_name
            audio_result = None
            audio_error = None
            try:
                audio_result = analyze_audio(audio_path)
            except Exception as error:
                audio_error = str(error)
            reject_reasons = ["No matching PDF source"]
            if audio_error:
                reject_reasons.append(f"Audio analysis failed: {audio_error}")
            empty_text_result = {
                "success": False,
                "pageCount": 0,
                "englishCharacters": 0,
                "englishWordCount": 0,
                "chineseCharacters": 0,
                "sentenceCount": 0,
                "longestSentenceWords": 0,
                "translationRatio": 0.0,
                "warnings": [],
                "error": "No matching PDF source",
            }
            records.append(
                {
                    "filename": audio_name,
                    "candidateLessonId": candidate_lesson_id(audio_path.stem),
                    "pdfMp3Match": {
                        "matched": False,
                        "pdf": None,
                        "mp3": audio_name,
                        "score": 0,
                        "status": "unmatched-audio",
                        "automatic": False,
                    },
                    "textExtraction": empty_text_result,
                    "garbledText": inspect_garbled_text("", ""),
                    "audioAnalysis": (
                        {
                            "success": True,
                            **audio_result,
                        }
                        if audio_result
                        else {
                            "success": False,
                            "error": audio_error,
                        }
                    ),
                    "alignmentPrediction": {
                        "result": "rejected",
                        "predictedWordsPerMinute": 0,
                        "sentenceCount": 0,
                        "reasons": ["No authoritative English text"],
                        "method": "heuristic-no-whisper-run",
                    },
                    "ready": False,
                    "rejectReasons": reject_reasons,
                }
            )

    ready_count = sum(record["ready"] for record in records)
    rejected_count = sum(not record["ready"] for record in records)
    report = {
        "sourceRoot": str(source_root),
        "evaluationMode": "non-destructive-heuristic-alignment",
        "pdfCount": matching["pdfCount"],
        "mp3Count": matching["mp3Count"],
        "extraAudioCount": len(matching["extraAudio"]),
        "extraAudio": matching["extraAudio"],
        "pairedRecordCount": len(matching["matches"]),
        "orphanAudioRecordCount": len(matching["extraAudio"]),
        "records": records,
        "summary": {
            "ready数量": ready_count,
            "rejected数量": rejected_count,
            "readyCount": ready_count,
            "rejectedCount": rejected_count,
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate all source materials without importing courses."
    )
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument(
        "--output",
        type=Path,
        default=STAGING_ROOT / "full-import-evaluation.json",
    )
    args = parser.parse_args()
    report = evaluate_full_import(args.source_root, args.output)
    print(json.dumps(report["summary"], ensure_ascii=False))
    print(f"Evaluation report: {args.output}")


if __name__ == "__main__":
    main()
