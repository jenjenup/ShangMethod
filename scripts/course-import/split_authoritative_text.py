from __future__ import annotations

import argparse
import json
from pathlib import Path

from text_normalization import split_sentences, tokenize


def load_authoritative_english(transcript_path: Path) -> str:
    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    sentences = transcript.get("sentences") or []
    english = " ".join(
        str(sentence.get("english", "")).strip()
        for sentence in sentences
        if str(sentence.get("english", "")).strip()
    )
    if not english:
        raise ValueError(f"No English text found in {transcript_path}")
    return english


def build_authoritative_sentences(transcript_path: Path) -> dict:
    english = load_authoritative_english(transcript_path)
    sentence_values = split_sentences(english)
    output_sentences: list[dict] = []
    token_offset = 0
    for sentence_id, sentence in enumerate(sentence_values, start=1):
        tokens = tokenize(sentence)
        if not tokens:
            continue
        output_sentences.append(
            {
                "id": sentence_id,
                "english": sentence,
                "tokens": tokens,
                "tokenStart": token_offset,
                "tokenEnd": token_offset + len(tokens),
            }
        )
        token_offset += len(tokens)
    return {
        "source": str(transcript_path),
        "sentenceCount": len(output_sentences),
        "tokenCount": token_offset,
        "sentences": output_sentences,
    }


def write_authoritative_sentences(value: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Split authoritative PDF English.")
    parser.add_argument("transcript", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    value = build_authoritative_sentences(args.transcript)
    write_authoritative_sentences(value, args.output)
    print(
        f"Authoritative sentences: {value['sentenceCount']}; "
        f"tokens: {value['tokenCount']}"
    )


if __name__ == "__main__":
    main()
