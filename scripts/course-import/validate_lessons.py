from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

from models import Transcript


CID_PATTERN = re.compile(r"\(cid:\d+\)")
LONG_LATIN_PATTERN = re.compile(r"[A-Za-z]{40,}")
VOCABULARY_HINT_PATTERN = re.compile(
    r"(?:^|\s)(?:adj|adv|prep|pron|conj|n|v)\.\s*[\u3400-\u9fff]",
    re.IGNORECASE,
)


def validate_transcript_data(data: dict, audio_path: Path | None = None) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    info: list[str] = []
    try:
        transcript = Transcript.model_validate(data)
    except Exception as error:
        return {
            "valid": False,
            "errors": [str(error)],
            "warnings": [],
            "info": [],
        }

    if audio_path is not None and not audio_path.is_file():
        errors.append(f"Audio file is missing: {audio_path}")

    combined_text = transcript.translation + "\n" + "\n".join(
        sentence.english + "\n" + sentence.chinese
        for sentence in transcript.sentences
    )
    cid_count = len(CID_PATTERN.findall(combined_text))
    if cid_count:
        warnings.append(f"Detected {cid_count} CID markers")
    long_latin = LONG_LATIN_PATTERN.findall(combined_text)
    if long_latin:
        warnings.append(
            f"Detected {len(long_latin)} unusually long Latin character sequences"
        )
    replacement_count = combined_text.count("\ufffd")
    if replacement_count:
        warnings.append(f"Detected {replacement_count} replacement characters")
    control_characters = [
        character
        for character in combined_text
        if unicodedata.category(character) == "Cc"
        and character not in {"\n", "\r", "\t"}
    ]
    if control_characters:
        warnings.append(
            f"Detected {len(control_characters)} unexpected control characters"
        )

    vocabulary_hints = len(VOCABULARY_HINT_PATTERN.findall(combined_text))
    info.append(
        f"Vocabulary-column hint count: {vocabulary_hints} "
        "(informational; does not block publishing)"
    )

    expected_end = transcript.durationSeconds
    if any(sentence.end > expected_end + 1 for sentence in transcript.sentences):
        errors.append("A sentence end exceeds the audio duration")
    if transcript.sentences[-1].end < expected_end - 1:
        warnings.append("The final sentence ends before the audio duration")

    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "info": info,
        "stats": {
            "englishCharacters": sum(
                len(sentence.english) for sentence in transcript.sentences
            ),
            "chineseCharacters": len(transcript.translation),
            "sentenceCount": len(transcript.sentences),
        },
    }


def validate_transcript_file(
    transcript_path: Path,
    audio_path: Path | None = None,
) -> dict:
    try:
        data = json.loads(transcript_path.read_text(encoding="utf-8"))
    except Exception as error:
        return {
            "valid": False,
            "errors": [f"Cannot read transcript JSON: {error}"],
            "warnings": [],
            "info": [],
        }
    return validate_transcript_data(data, audio_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a lesson transcript.")
    parser.add_argument("transcript", type=Path)
    parser.add_argument("--audio", type=Path)
    args = parser.parse_args()
    report = validate_transcript_file(args.transcript, args.audio)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["valid"] else 1)


if __name__ == "__main__":
    main()
