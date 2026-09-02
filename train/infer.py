#!/usr/bin/env python3
"""학습된 NER 모델로 지명 구간을 뽑습니다."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer, pipeline

HERE = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=HERE / "output" / "koelectra-ner")
    parser.add_argument("--text", default="")
    parser.add_argument("--file", type=Path)
    args = parser.parse_args()

    nlp = pipeline(
        "token-classification",
        model=AutoModelForTokenClassification.from_pretrained(args.model),
        tokenizer=AutoTokenizer.from_pretrained(args.model),
        aggregation_strategy="simple",
        device=0 if torch.cuda.is_available() else -1,
    )

    texts: list[str] = []
    if args.text:
        texts.append(args.text)
    if args.file:
        raw = args.file.read_text(encoding="utf-8")
        if args.file.suffix == ".jsonl":
            texts.extend(json.loads(line)["text"] for line in raw.splitlines() if line.strip())
        else:
            texts.extend(line for line in raw.splitlines() if line.strip())
    if not texts:
        raise SystemExit("pass --text or --file")

    for text in texts:
        ents = nlp(text)
        print(
            json.dumps(
                {
                    "text": text,
                    "entities": [
                        {
                            "start": int(row["start"]),
                            "end": int(row["end"]),
                            "label": row["entity_group"],
                            "score": round(float(row["score"]), 4),
                            "text": text[int(row["start"]) : int(row["end"])],
                        }
                        for row in ents
                    ],
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
