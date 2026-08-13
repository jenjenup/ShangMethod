from __future__ import annotations

import argparse
import json
from pathlib import Path

from text_normalization import normalize_word


def transcribe_audio(
    audio_path: Path,
    *,
    model_name: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
) -> dict:
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise RuntimeError(
            "faster-whisper is required. Install scripts/course-import/requirements.txt"
        ) from error

    model = WhisperModel(
        model_name,
        device=device,
        compute_type=compute_type,
    )
    segments_iterator, info = model.transcribe(
        str(audio_path),
        language="en",
        beam_size=5,
        temperature=0,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={
            "min_silence_duration_ms": 500,
            "speech_pad_ms": 250,
        },
        condition_on_previous_text=True,
    )

    words: list[dict] = []
    segments: list[dict] = []
    for segment in segments_iterator:
        segment_words: list[int] = []
        for word in segment.words or []:
            normalized = normalize_word(word.word)
            if not normalized or word.start is None or word.end is None:
                continue
            word_index = len(words)
            words.append(
                {
                    "index": word_index,
                    "word": word.word.strip(),
                    "normalized": normalized,
                    "start": round(float(word.start), 3),
                    "end": round(float(word.end), 3),
                    "probability": round(float(word.probability), 4),
                }
            )
            segment_words.append(word_index)
        segments.append(
            {
                "id": int(segment.id),
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": segment.text.strip(),
                "wordIndexes": segment_words,
            }
        )

    return {
        "audio": str(audio_path),
        "model": model_name,
        "device": device,
        "computeType": compute_type,
        "language": info.language,
        "languageProbability": round(float(info.language_probability), 4),
        "durationSeconds": round(float(info.duration), 3),
        "durationAfterVadSeconds": round(float(info.duration_after_vad), 3),
        "parameters": {
            "beamSize": 5,
            "temperature": 0,
            "wordTimestamps": True,
            "vadFilter": True,
            "minSilenceDurationMs": 500,
            "speechPadMs": 250,
            "conditionOnPreviousText": True,
        },
        "segments": segments,
        "words": words,
    }


def write_transcription(value: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Create Whisper word timestamps.")
    parser.add_argument("audio", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()
    value = transcribe_audio(
        args.audio,
        model_name=args.model,
        device=args.device,
        compute_type=args.compute_type,
    )
    write_transcription(value, args.output)
    print(f"Whisper words: {len(value['words'])}")


if __name__ == "__main__":
    main()
