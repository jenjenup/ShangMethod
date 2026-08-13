from __future__ import annotations

import argparse
import difflib
import json
from pathlib import Path


def word_similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    return difflib.SequenceMatcher(None, left, right).ratio()


def align_replacement(
    authoritative: list[str],
    recognized: list[str],
    authoritative_offset: int,
    recognized_offset: int,
) -> dict[int, tuple[int, float]]:
    if not authoritative or not recognized:
        return {}
    if max(len(authoritative), len(recognized)) > 160:
        return {}

    row_count = len(authoritative) + 1
    column_count = len(recognized) + 1
    scores = [[0.0] * column_count for _ in range(row_count)]
    moves = [[""] * column_count for _ in range(row_count)]
    gap_penalty = -0.65
    for row in range(1, row_count):
        scores[row][0] = scores[row - 1][0] + gap_penalty
        moves[row][0] = "up"
    for column in range(1, column_count):
        scores[0][column] = scores[0][column - 1] + gap_penalty
        moves[0][column] = "left"

    for row in range(1, row_count):
        for column in range(1, column_count):
            similarity = word_similarity(
                authoritative[row - 1],
                recognized[column - 1],
            )
            substitution = scores[row - 1][column - 1] + (2 * similarity - 0.75)
            deletion = scores[row - 1][column] + gap_penalty
            insertion = scores[row][column - 1] + gap_penalty
            best = max(substitution, deletion, insertion)
            scores[row][column] = best
            moves[row][column] = (
                "diag"
                if best == substitution
                else "up"
                if best == deletion
                else "left"
            )

    matches: dict[int, tuple[int, float]] = {}
    row = len(authoritative)
    column = len(recognized)
    while row or column:
        move = moves[row][column]
        if move == "diag":
            similarity = word_similarity(
                authoritative[row - 1],
                recognized[column - 1],
            )
            if similarity >= 0.72:
                matches[authoritative_offset + row - 1] = (
                    recognized_offset + column - 1,
                    similarity,
                )
            row -= 1
            column -= 1
        elif move == "up":
            row -= 1
        elif move == "left":
            column -= 1
        else:
            break
    return matches


def build_word_mapping(
    authoritative_tokens: list[str],
    recognized_tokens: list[str],
) -> dict[int, tuple[int, float]]:
    matcher = difflib.SequenceMatcher(
        None,
        authoritative_tokens,
        recognized_tokens,
        autojunk=False,
    )
    mapping: dict[int, tuple[int, float]] = {}
    for tag, left_start, left_end, right_start, right_end in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(left_end - left_start):
                mapping[left_start + offset] = (right_start + offset, 1.0)
        elif tag == "replace":
            mapping.update(
                align_replacement(
                    authoritative_tokens[left_start:left_end],
                    recognized_tokens[right_start:right_end],
                    left_start,
                    right_start,
                )
            )
    return mapping


def confidence_level(
    coverage: float,
    average_probability: float,
    average_similarity: float,
    estimated: bool,
) -> str:
    if estimated or coverage < 0.45:
        return "low"
    if coverage >= 0.8 and average_probability >= 0.7 and average_similarity >= 0.9:
        return "high"
    return "medium"


def build_alignment(
    lesson_id: str,
    authoritative: dict,
    transcription: dict,
) -> dict:
    sentences = authoritative["sentences"]
    authoritative_tokens = [
        token for sentence in sentences for token in sentence["tokens"]
    ]
    words = transcription["words"]
    recognized_tokens = [word["normalized"] for word in words]
    mapping = build_word_mapping(authoritative_tokens, recognized_tokens)
    audio_duration = float(transcription["durationSeconds"])

    segments: list[dict] = []
    for sentence in sentences:
        token_start = sentence["tokenStart"]
        token_end = sentence["tokenEnd"]
        mapped = [
            (token_index, mapping[token_index])
            for token_index in range(token_start, token_end)
            if token_index in mapping
        ]
        token_count = token_end - token_start
        coverage = len(mapped) / token_count if token_count else 0
        estimated = not mapped
        if mapped:
            recognized_indexes = [match[1][0] for match in mapped]
            matched_words = [words[index] for index in recognized_indexes]
            start = max(0.0, float(matched_words[0]["start"]) - 0.08)
            end = min(audio_duration, float(matched_words[-1]["end"]) + 0.12)
            average_probability = sum(
                float(word["probability"]) for word in matched_words
            ) / len(matched_words)
            average_similarity = sum(match[1][1] for match in mapped) / len(mapped)
        else:
            start = 0.0
            end = 0.0
            average_probability = 0.0
            average_similarity = 0.0

        segments.append(
            {
                "id": sentence["id"],
                "english": sentence["english"],
                "start": round(start, 3),
                "end": round(end, 3),
                "confidence": confidence_level(
                    coverage,
                    average_probability,
                    average_similarity,
                    estimated,
                ),
                "matchCoverage": round(coverage, 4),
                "averageWordProbability": round(average_probability, 4),
                "averageMatchSimilarity": round(average_similarity, 4),
                "matchedWordCount": len(mapped),
                "wordCount": token_count,
                "estimated": estimated,
            }
        )

    # Padding can make adjacent ranges overlap slightly. Split the overlap at its
    # midpoint so the exported timeline remains monotonic without inventing text.
    previous_segment: dict | None = None
    for segment in segments:
        if segment["estimated"] or segment["end"] <= segment["start"]:
            continue
        if (
            previous_segment is not None
            and segment["start"] < previous_segment["end"]
        ):
            boundary = round(
                (float(segment["start"]) + float(previous_segment["end"])) / 2,
                3,
            )
            previous_segment["end"] = boundary
            segment["start"] = boundary
        previous_segment = segment

    # Missing sentences retain an explicit zero range. Do not invent timestamps.
    matched_token_count = len(mapping)
    return {
        "lessonId": lesson_id,
        "audioDurationSeconds": audio_duration,
        "model": transcription["model"],
        "authoritativeTokenCount": len(authoritative_tokens),
        "recognizedWordCount": len(recognized_tokens),
        "matchedTokenCount": matched_token_count,
        "coverage": round(
            matched_token_count / len(authoritative_tokens)
            if authoritative_tokens
            else 0,
            4,
        ),
        "segments": segments,
    }


def write_alignment(value: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Align authoritative sentences.")
    parser.add_argument("lesson_id")
    parser.add_argument("authoritative", type=Path)
    parser.add_argument("whisper_words", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    authoritative = json.loads(args.authoritative.read_text(encoding="utf-8"))
    transcription = json.loads(args.whisper_words.read_text(encoding="utf-8"))
    value = build_alignment(args.lesson_id, authoritative, transcription)
    write_alignment(value, args.output)
    print(
        f"Alignment: {len(value['segments'])} sentences; "
        f"coverage={value['coverage']:.1%}"
    )


if __name__ == "__main__":
    main()
