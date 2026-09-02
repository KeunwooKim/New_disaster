#!/usr/bin/env python3
"""silver.jsonl → 학습/검증/테스트 JSONL (문자 offset 엔티티)."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TYPE_TO_LABEL = json.loads((HERE / "labels.json").read_text(encoding="utf-8"))["type_to_label"]


def split_name(text: str) -> str:
    bucket = int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16) % 100
    if bucket < 5:
        return "test"
    if bucket < 10:
        return "dev"
    return "train"


def normalize_spans(text: str, spans: list[dict]) -> list[dict]:
    cleaned: list[dict] = []
    occupied = [False] * len(text)
    ordered = sorted(spans, key=lambda row: (row["start"], -(row["end"] - row["start"])))
    for span in ordered:
        start = int(span["start"])
        end = int(span["end"])
        kind = TYPE_TO_LABEL.get(span.get("type", ""))
        if not kind or start < 0 or end > len(text) or start >= end:
            continue
        if text[start:end] != span.get("text", text[start:end]):
            continue
        if any(occupied[start:end]):
            continue
        for i in range(start, end):
            occupied[i] = True
        cleaned.append({"start": start, "end": end, "label": kind})
    cleaned.sort(key=lambda row: row["start"])
    return cleaned


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=Path, default=ROOT / "data" / "ner" / "silver.jsonl")
    parser.add_argument("--out", type=Path, default=HERE / "data")
    args = parser.parse_args()

    if not args.src.exists():
        raise SystemExit(f"missing {args.src}")

    seen: set[str] = set()
    splits: dict[str, list[dict]] = {"train": [], "dev": [], "test": []}
    types = Counter()
    skipped_dup = 0

    with args.src.open(encoding="utf-8") as fh:
        for line in fh:
            rec = json.loads(line)
            text = rec.get("text") or ""
            if not text or text in seen:
                skipped_dup += 1
                continue
            seen.add(text)
            entities = normalize_spans(text, rec.get("spans") or [])
            for ent in entities:
                types[ent["label"]] += 1
            splits[split_name(text)].append(
                {
                    "id": str(rec.get("sn", "")),
                    "sender": rec.get("sender") or "",
                    "text": text,
                    "entities": entities,
                }
            )

    args.out.mkdir(parents=True, exist_ok=True)
    counts = {}
    for name, rows in splits.items():
        path = args.out / f"{name}.jsonl"
        with path.open("w", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        counts[name] = {"rows": len(rows), "bytes": path.stat().st_size}

    meta = {
        "source": str(args.src),
        "unique_texts": len(seen),
        "skipped_dup": skipped_dup,
        "splits": counts,
        "entity_types": dict(types),
        "labels": json.loads((HERE / "labels.json").read_text(encoding="utf-8"))["labels"],
    }
    (args.out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
