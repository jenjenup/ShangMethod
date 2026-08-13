from __future__ import annotations

import argparse
import csv
import json
import os
import re
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from config import PROJECT_ROOT, STAGING_ROOT


DEFAULT_MANIFEST_PATH = PROJECT_ROOT / "public" / "lessons" / "lessons.json"
DEFAULT_DICTIONARY_PATH = PROJECT_ROOT / "public" / "dictionary.json"
DEFAULT_REPORT_PATH = STAGING_ROOT / "dictionary-generation-report.json"
DEFAULT_UNRESOLVED_PATH = STAGING_ROOT / "dictionary-unresolved-words.json"

# This mirrors the clickable-word branch of tokenizeForComparison() in
# app/page.tsx. Keep both the token pattern and dictionary-key normalization
# synchronized with the webpage.
CLICKABLE_WORD_PATTERN = re.compile(
    r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*"
)
APOSTROPHE_PATTERN = re.compile(r"['’]")
CHINESE_PATTERN = re.compile(r"[\u3400-\u9fff]")
WHITESPACE_PATTERN = re.compile(r"\s+")


@dataclass
class WordUsage:
    occurrence_count: int = 0
    lesson_ids: set[str] = field(default_factory=set)
    examples: list[str] = field(default_factory=list)


def normalize_dictionary_key(word: str) -> str:
    return APOSTROPHE_PATTERN.sub("", word.lower())


def tokenize_clickable_words(text: str) -> list[str]:
    return CLICKABLE_WORD_PATTERN.findall(text)


def clean_translation(value: str) -> str | None:
    meanings: list[str] = []
    seen: set[str] = set()
    for raw_line in value.replace("\\n", "\n").splitlines():
        meaning = WHITESPACE_PATTERN.sub(" ", raw_line).strip()
        if not meaning or not CHINESE_PATTERN.search(meaning):
            continue
        if meaning in seen:
            continue
        meanings.append(meaning)
        seen.add(meaning)
        if len(meanings) == 3:
            break
    return "；".join(meanings) or None


def parse_exchange(value: str) -> Iterable[tuple[str, str]]:
    for item in value.split("/"):
        if ":" not in item:
            continue
        exchange_type, exchange_word = item.split(":", 1)
        exchange_word = exchange_word.strip()
        if exchange_type and exchange_word:
            yield exchange_type, exchange_word


def load_json_object(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return payload


def resolve_transcript_path(manifest_path: Path, transcript_url: str) -> Path:
    if not transcript_url.startswith("/"):
        raise ValueError(f"Transcript path must start with '/': {transcript_url}")
    public_root = manifest_path.parent.parent
    return public_root / transcript_url.lstrip("/")


def collect_course_words(
    manifest_path: Path,
) -> tuple[list[dict], dict[str, WordUsage], int, int]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, list):
        raise ValueError("lessons.json must contain an array")

    usages: dict[str, WordUsage] = {}
    course_rows: list[dict] = []
    sentence_count = 0
    token_count = 0

    for lesson in manifest:
        lesson_id = lesson["id"]
        transcript_path = resolve_transcript_path(
            manifest_path,
            lesson["transcript"],
        )
        transcript = load_json_object(transcript_path)
        sentences = transcript.get("sentences")
        if not isinstance(sentences, list):
            raise ValueError(f"Missing sentences array: {transcript_path}")

        course_words: set[str] = set()
        for sentence in sentences:
            english = sentence.get("english")
            if not isinstance(english, str):
                raise ValueError(
                    f"Invalid sentence English text: {transcript_path}"
                )
            sentence_count += 1
            tokens = tokenize_clickable_words(english)
            token_count += len(tokens)
            for token in tokens:
                key = normalize_dictionary_key(token)
                if not key:
                    continue
                usage = usages.setdefault(key, WordUsage())
                usage.occurrence_count += 1
                usage.lesson_ids.add(lesson_id)
                if english not in usage.examples and len(usage.examples) < 2:
                    usage.examples.append(english)
                course_words.add(key)

        course_rows.append(
            {
                "lessonId": lesson_id,
                "uniqueWordCount": len(course_words),
                "_words": course_words,
            }
        )

    return course_rows, usages, sentence_count, token_count


def load_ecdict_matches(
    csv_path: Path,
    target_words: set[str],
) -> tuple[dict[str, str], dict[str, str]]:
    direct_matches: dict[str, str] = {}
    lemma_matches: dict[str, str] = {}
    lemma_requests: dict[str, str] = {}

    csv.field_size_limit(16 * 1024 * 1024)
    with csv_path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        required = {"word", "translation", "exchange"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError(
                "ECDICT CSV must include word, translation and exchange fields"
            )

        for row in reader:
            word = (row.get("word") or "").strip()
            if not word:
                continue
            dictionary_key = normalize_dictionary_key(word)
            translation = clean_translation(row.get("translation") or "")

            if dictionary_key in target_words and translation:
                direct_matches.setdefault(dictionary_key, translation)

            exchange = row.get("exchange") or ""
            for exchange_type, exchange_word in parse_exchange(exchange):
                exchange_key = normalize_dictionary_key(exchange_word)
                if (
                    exchange_key in target_words
                    and translation
                    and exchange_key != dictionary_key
                ):
                    lemma_matches.setdefault(exchange_key, translation)
                if exchange_type == "0" and dictionary_key in target_words:
                    lemma_requests.setdefault(
                        dictionary_key,
                        normalize_dictionary_key(exchange_word),
                    )

    unresolved_lemma_bases = {
        base
        for target, base in lemma_requests.items()
        if target not in direct_matches and target not in lemma_matches and base
    }
    if unresolved_lemma_bases:
        base_translations: dict[str, str] = {}
        with csv_path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            for row in reader:
                base_key = normalize_dictionary_key(
                    (row.get("word") or "").strip()
                )
                if base_key not in unresolved_lemma_bases:
                    continue
                translation = clean_translation(row.get("translation") or "")
                if translation:
                    base_translations.setdefault(base_key, translation)

        for target, base in lemma_requests.items():
            translation = base_translations.get(base)
            if (
                translation
                and target not in direct_matches
                and target not in lemma_matches
            ):
                lemma_matches[target] = translation

    return direct_matches, lemma_matches


def write_json_atomic(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(
                payload,
                stream,
                ensure_ascii=False,
                indent=2,
                sort_keys=isinstance(payload, dict),
            )
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        json.loads(temporary_path.read_text(encoding="utf-8"))
        temporary_path.replace(path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def generate_dictionary(
    *,
    manifest_path: Path,
    ecdict_path: Path,
    dictionary_path: Path,
    report_path: Path,
    unresolved_path: Path,
) -> dict:
    course_rows, usages, sentence_count, token_count = collect_course_words(
        manifest_path
    )
    existing_raw = load_json_object(dictionary_path)
    existing = {
        key: value
        for key, value in existing_raw.items()
        if isinstance(key, str)
        and isinstance(value, str)
        and value.strip()
    }
    if len(existing) != len(existing_raw):
        raise ValueError("Existing dictionary contains invalid or empty entries")

    target_words = set(usages)
    existing_hits = target_words & set(existing)
    direct_matches, lemma_matches = load_ecdict_matches(
        ecdict_path,
        target_words - existing_hits,
    )
    direct_matches = {
        key: value
        for key, value in direct_matches.items()
        if key not in existing_hits
    }
    lemma_matches = {
        key: value
        for key, value in lemma_matches.items()
        if key not in existing_hits and key not in direct_matches
    }

    final_dictionary = dict(existing)
    final_dictionary.update(direct_matches)
    final_dictionary.update(lemma_matches)
    final_dictionary = dict(sorted(final_dictionary.items()))
    if any(not value.strip() for value in final_dictionary.values()):
        raise ValueError("Generated dictionary contains an empty definition")

    covered_words = target_words & set(final_dictionary)
    unresolved_words = target_words - covered_words
    for row in course_rows:
        words = row.pop("_words")
        covered_count = len(words & covered_words)
        row["coveredWordCount"] = covered_count
        row["coverage"] = (
            round(covered_count / len(words), 6) if words else 1.0
        )

    unresolved_rows = [
        {
            "word": word,
            "occurrenceCount": usages[word].occurrence_count,
            "lessonIds": sorted(usages[word].lesson_ids),
            "examples": usages[word].examples,
        }
        for word in sorted(
            unresolved_words,
            key=lambda item: (-usages[item].occurrence_count, item),
        )
    ]

    report = {
        "publishedCourseCount": len(course_rows),
        "scannedSentenceCount": sentence_count,
        "englishWordTokenCount": token_count,
        "uniqueNormalizedWordCount": len(target_words),
        "existingDictionaryHitCount": len(existing_hits),
        "ecdictDirectHitCount": len(direct_matches),
        "lemmaExchangeHitCount": len(lemma_matches),
        "unresolvedWordCount": len(unresolved_words),
        "finalDictionaryEntryCount": len(final_dictionary),
        "overallCoverage": (
            round(len(covered_words) / len(target_words), 6)
            if target_words
            else 1.0
        ),
        "courses": course_rows,
    }

    write_json_atomic(dictionary_path, final_dictionary)
    write_json_atomic(report_path, report)
    write_json_atomic(unresolved_path, unresolved_rows)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Generate the published-course global dictionary from ECDICT."
        )
    )
    parser.add_argument(
        "--ecdict",
        type=Path,
        required=True,
        help="Path to a local official ECDICT ecdict.csv file",
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    parser.add_argument(
        "--dictionary",
        type=Path,
        default=DEFAULT_DICTIONARY_PATH,
    )
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument(
        "--unresolved",
        type=Path,
        default=DEFAULT_UNRESOLVED_PATH,
    )
    args = parser.parse_args()

    if not args.ecdict.is_file():
        raise FileNotFoundError(args.ecdict)

    report = generate_dictionary(
        manifest_path=args.manifest,
        ecdict_path=args.ecdict,
        dictionary_path=args.dictionary,
        report_path=args.report,
        unresolved_path=args.unresolved,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
