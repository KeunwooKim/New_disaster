#!/usr/bin/env python3
"""KoELECTRA 토큰 분류 미세조정. GPU 있는 컴퓨터에서 실행하세요."""

from __future__ import annotations

import argparse
import inspect
import json
from pathlib import Path

import torch
from seqeval.metrics import f1_score, precision_score, recall_score
from torch.utils.data import Dataset
from transformers import (
    AutoModelForTokenClassification,
    AutoTokenizer,
    DataCollatorForTokenClassification,
    Trainer,
    TrainingArguments,
)

HERE = Path(__file__).resolve().parent
LABELS = json.loads((HERE / "labels.json").read_text(encoding="utf-8"))["labels"]
LABEL2ID = {name: i for i, name in enumerate(LABELS)}
ID2LABEL = {i: name for name, i in LABEL2ID.items()}


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def char_tags(text: str, entities: list[dict]) -> list[str]:
    tags = ["O"] * len(text)
    for ent in sorted(entities, key=lambda row: (row["start"], -(row["end"] - row["start"]))):
        start, end, label = ent["start"], ent["end"], ent["label"]
        if start < 0 or end > len(text) or start >= end:
            continue
        tags[start] = f"B-{label}"
        for i in range(start + 1, end):
            tags[i] = f"I-{label}"
    return tags


def encode_row(tokenizer, text: str, entities: list[dict], max_length: int) -> dict:
    tags = char_tags(text, entities)
    encoded = tokenizer(
        text,
        truncation=True,
        max_length=max_length,
        return_offsets_mapping=True,
        return_overflowing_tokens=False,
    )
    labels = []
    for start, end in encoded["offset_mapping"]:
        if start == end:
            labels.append(-100)
            continue
        labels.append(LABEL2ID[tags[start]])
    encoded.pop("offset_mapping")
    encoded["labels"] = labels
    return {key: torch.tensor(value) for key, value in encoded.items()}


class NerDataset(Dataset):
    def __init__(self, rows: list[dict], tokenizer, max_length: int):
        self.features = [encode_row(tokenizer, row["text"], row.get("entities") or [], max_length) for row in rows]

    def __len__(self) -> int:
        return len(self.features)

    def __getitem__(self, index: int) -> dict:
        return self.features[index]


def decode_label_ids(label_ids, predictions) -> tuple[list[list[str]], list[list[str]]]:
    true_tags: list[list[str]] = []
    pred_tags: list[list[str]] = []
    for gold, pred in zip(label_ids, predictions):
        gold_row = []
        pred_row = []
        for g, p in zip(gold, pred):
            if g == -100:
                continue
            gold_row.append(ID2LABEL[g])
            pred_row.append(ID2LABEL[p])
        true_tags.append(gold_row)
        pred_tags.append(pred_row)
    return true_tags, pred_tags


def compute_metrics(eval_pred):
    logits, labels = eval_pred
    preds = logits.argmax(-1)
    true_tags, pred_tags = decode_label_ids(labels, preds)
    return {
        "precision": precision_score(true_tags, pred_tags),
        "recall": recall_score(true_tags, pred_tags),
        "f1": f1_score(true_tags, pred_tags),
    }


def make_trainer(**kwargs) -> Trainer:
    params = inspect.signature(Trainer.__init__).parameters
    if "processing_class" in params:
        tokenizer = kwargs.pop("tokenizer")
        return Trainer(processing_class=tokenizer, **kwargs)
    return Trainer(**kwargs)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=HERE / "data")
    parser.add_argument("--out", type=Path, default=HERE / "output" / "koelectra-ner")
    parser.add_argument("--model", default="monologg/koelectra-base-v3-discriminator")
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--max-length", type=int, default=192)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-steps", type=int, default=-1)
    args = parser.parse_args()

    train_rows = load_jsonl(args.data / "train.jsonl")
    dev_rows = load_jsonl(args.data / "dev.jsonl")
    if not train_rows:
        raise SystemExit(f"empty train set in {args.data}; run prepare.py first")

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForTokenClassification.from_pretrained(
        args.model,
        num_labels=len(LABELS),
        id2label=ID2LABEL,
        label2id=LABEL2ID,
    )
    train_ds = NerDataset(train_rows, tokenizer, args.max_length)
    dev_ds = NerDataset(dev_rows, tokenizer, args.max_length)
    use_cuda = torch.cuda.is_available()

    ta_params = inspect.signature(TrainingArguments.__init__).parameters
    eval_key = "eval_strategy" if "eval_strategy" in ta_params else "evaluation_strategy"
    training_kwargs = {
        "output_dir": str(args.out / "checkpoints"),
        "num_train_epochs": args.epochs,
        "per_device_train_batch_size": args.batch_size,
        "per_device_eval_batch_size": args.batch_size,
        "learning_rate": args.lr,
        "weight_decay": 0.01,
        "warmup_ratio": 0.1,
        eval_key: "epoch",
        "save_strategy": "epoch",
        "load_best_model_at_end": True,
        "metric_for_best_model": "f1",
        "greater_is_better": True,
        "logging_steps": 50,
        "seed": args.seed,
        "fp16": use_cuda,
        "report_to": [],
        "save_total_limit": 2,
    }
    if args.max_steps > 0:
        training_kwargs["max_steps"] = args.max_steps
    training_args = TrainingArguments(**training_kwargs)
    trainer = make_trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=dev_ds,
        data_collator=DataCollatorForTokenClassification(tokenizer),
        tokenizer=tokenizer,
        compute_metrics=compute_metrics,
    )
    trainer.train()
    metrics = trainer.evaluate()
    args.out.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(args.out))
    tokenizer.save_pretrained(str(args.out))
    (args.out / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    print(f"saved {args.out}")


if __name__ == "__main__":
    main()
