from __future__ import annotations

import argparse
import json
from pathlib import Path

import av

from config import duration_category


def analyze_audio(audio_path: Path) -> dict:
    with av.open(str(audio_path)) as container:
        audio_streams = [stream for stream in container.streams if stream.type == "audio"]
        if not audio_streams:
            raise ValueError(f"No audio stream found: {audio_path}")
        stream = audio_streams[0]
        duration_seconds = (
            float(container.duration / av.time_base)
            if container.duration is not None
            else float(stream.duration * stream.time_base)
        )
        return {
            "path": str(audio_path),
            "format": container.format.name,
            "durationSeconds": round(duration_seconds, 3),
            "durationCategory": duration_category(duration_seconds),
            "sampleRate": stream.sample_rate,
            "channels": stream.channels,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Read MP3 metadata.")
    parser.add_argument("audio", type=Path)
    args = parser.parse_args()
    print(json.dumps(analyze_audio(args.audio), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
