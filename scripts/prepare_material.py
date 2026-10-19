"""Read text or transcribe audio, then emit a stable JSON processing artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "then", "than", "so", "as", "of", "to", "in", "on", "at", "by", "for", "from",
    "with", "about", "into", "over", "after", "before", "between", "during", "through", "is", "are", "was", "were", "be", "been",
    "being", "am", "do", "does", "did", "has", "have", "had", "can", "could", "may", "might", "must", "shall", "should", "will",
    "would", "i", "you", "he", "she", "it", "we", "they", "this", "that", "these", "those", "there", "here", "which", "who", "what",
    "when", "where", "why", "how", "not", "no", "yes", "all", "any", "some", "more", "most", "other", "such", "very", "also", "just",
    "like", "well", "really", "uh", "um", "okay", "ok", "right", "yeah", "youre", "its", "im", "dont", "cant", "thats", "lets",
}
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'-]{2,}")


def normalize(term: str) -> str:
    word = term.lower().replace("’", "'").strip("'-")
    if len(word) > 5 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 5 and word.endswith("sses"):
        return word[:-2]
    if len(word) > 4 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def extract_docx(path: Path) -> str:
    from docx import Document

    return "\n".join(p.text for p in Document(path).paragraphs if p.text.strip())


def extract_pdf(path: Path) -> str:
    from pypdf import PdfReader

    return "\n".join(page.extract_text() or "" for page in PdfReader(str(path)).pages)


def resolve_model() -> str:
    """WHISPER_MODEL (name or path) wins; else a large-v3 snapshot under WHISPER_MODEL_DIR; else download "large-v3"."""
    explicit = os.environ.get("WHISPER_MODEL")
    if explicit:
        return explicit
    model_root = os.environ.get("WHISPER_MODEL_DIR")
    if model_root:
        snapshots = sorted(Path(model_root).glob("models--Systran--faster-whisper-large-v3/snapshots/*"))
        if snapshots:
            return str(snapshots[0])
    return "large-v3"


def transcribe(path: Path) -> tuple[str, list[dict], float | None]:
    # Optional extra site-packages folder, for a faster-whisper install kept outside the main Python.
    package_root = os.environ.get("WHISPER_PACKAGES_DIR")
    if package_root and Path(package_root).is_dir() and package_root not in sys.path:
        sys.path.insert(0, package_root)
    from faster_whisper import WhisperModel

    model_path = resolve_model()
    try:
        model = WhisperModel(model_path, device="cuda", compute_type="float16")
    except Exception:
        model = WhisperModel(model_path, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(path), language="en", vad_filter=True, beam_size=5)
    rows = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            rows.append({"start": round(segment.start, 2), "end": round(segment.end, 2), "text": text})
    return "\n".join(item["text"] for item in rows), rows, float(info.duration)


def prepare(path: Path) -> dict:
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    suffix = path.suffix.lower()
    segments: list[dict] = []
    duration = None
    if suffix in {".txt", ".md", ".markdown", ".csv"}:
        text = raw.decode("utf-8-sig")
    elif suffix == ".docx":
        text = extract_docx(path)
    elif suffix == ".pdf":
        text = extract_pdf(path)
    elif suffix in {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}:
        text, segments, duration = transcribe(path)
    else:
        raise ValueError(f"Unsupported input type: {suffix or '(none)'}")
    text = text.strip()
    tokens = [m.group(0) for m in WORD_RE.finditer(text)]
    counts: dict[str, int] = {}
    positions: dict[str, list[int]] = {}
    for index, token in enumerate(tokens):
        key = normalize(token)
        if key in STOPWORDS or len(key) < 3:
            continue
        counts[key] = counts.get(key, 0) + 1
        positions.setdefault(key, []).append(index + 1)
    candidates = [
        {"term": key, "normalized": key, "count": count, "token_positions": positions[key]}
        for key, count in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
    ]
    return {
        "source": {
            "path": str(path),
            "title": path.stem,
            "sha256": digest,
            "type": suffix.lstrip(".") or "text",
            "duration_seconds": duration,
            "prepared_at": datetime.now(timezone.utc).isoformat(),
        },
        "text": text,
        "segments": segments,
        "candidates": candidates,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--json", action="store_true", help="emit JSON to stdout")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not args.input.is_file():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 2
    try:
        payload = prepare(args.input)
    except Exception as exc:
        print(f"Could not prepare material: {exc}", file=sys.stderr)
        return 2
    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(serialized, encoding="utf-8")
    if args.json or not args.output:
        print(serialized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
