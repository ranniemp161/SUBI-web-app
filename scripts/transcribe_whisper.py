"""Transcribe a local video/audio file with faster-whisper, print JSON to stdout.

Temporary local stand-in for the Deepgram pipeline while Deepgram project
access is being sorted out with the client. Invoked as a subprocess from
src/app/api/transcribe/whisper/route.ts.

Usage: python transcribe_whisper.py <path-to-media-file>
"""

import json
import sys

from faster_whisper import WhisperModel


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: transcribe_whisper.py <path-to-media-file>", file=sys.stderr)
        sys.exit(1)

    media_path = sys.argv[1]

    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, info = model.transcribe(media_path, beam_size=5, word_timestamps=True)

    segments = list(segments)

    words = [
        {
            "word": word.word.strip(),
            "start": word.start,
            "end": word.end,
            "confidence": round(word.probability, 4),
        }
        for segment in segments
        for word in (segment.words or [])
    ]

    result = {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "words": words,
        "text": " ".join(segment.text.strip() for segment in segments),
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
