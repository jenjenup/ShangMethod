from __future__ import annotations

import re
import unicodedata


WORD_PATTERN = re.compile(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*")
ABBREVIATIONS = {
    "a.m.",
    "d.c.",
    "dr.",
    "e.g.",
    "i.e.",
    "jr.",
    "mr.",
    "mrs.",
    "ms.",
    "ph.d.",
    "p.m.",
    "prof.",
    "sq.",
    "sr.",
    "st.",
    "u.k.",
    "u.s.",
    "vs.",
}


def normalize_word(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    normalized = normalized.replace("’", "'").replace("‘", "'").lower()
    return "".join(character for character in normalized if character.isalnum())


def tokenize(value: str) -> list[str]:
    return [
        normalized
        for match in WORD_PATTERN.finditer(value)
        if (normalized := normalize_word(match.group(0)))
    ]


def split_sentences(value: str) -> list[str]:
    text = re.sub(r"\s+", " ", value).strip()
    if not text:
        return []

    sentences: list[str] = []
    start = 0
    for match in re.finditer(r"[.!?]+(?:[\"'”’)\]]+)?(?=\s+|$)", text):
        candidate = text[start : match.end()].strip()
        final_word = candidate.split()[-1].lower().strip("\"'”’)]")
        following_text = text[match.end() :].lstrip()
        if final_word in ABBREVIATIONS:
            continue
        if re.search(r"\b[A-Z]\.$", candidate):
            continue
        if (
            candidate.endswith(".")
            and following_text
            and following_text[0].islower()
        ):
            continue
        if candidate:
            sentences.append(candidate)
        start = match.end()

    remainder = text[start:].strip()
    if remainder:
        sentences.append(remainder)
    return sentences
