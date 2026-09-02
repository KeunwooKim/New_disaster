#!/usr/bin/env python3
"""KoELECTRA NER HTTP 서버. 127.0.0.1 에서만 받습니다."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer, pipeline

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = Path(os.environ.get("NER_MODEL", ROOT / "models" / "koelectra-ner"))
HOST = os.environ.get("NER_HOST", "127.0.0.1")
PORT = int(os.environ.get("NER_PORT", "3002"))

print(f"loading NER from {MODEL_DIR}", flush=True)
nlp = pipeline(
    "token-classification",
    model=AutoModelForTokenClassification.from_pretrained(MODEL_DIR),
    tokenizer=AutoTokenizer.from_pretrained(MODEL_DIR),
    aggregation_strategy="simple",
    device=0 if torch.cuda.is_available() else -1,
)
print("NER ready", flush=True)


def predict(text: str) -> list[dict]:
    if not text.strip():
        return []
    ents = []
    for row in nlp(text):
        start = int(row["start"])
        end = int(row["end"])
        ents.append(
            {
                "start": start,
                "end": end,
                "label": row["entity_group"],
                "score": round(float(row["score"]), 4),
                "text": text[start:end],
            }
        )
    return ents


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:
        return

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            self._json(200, {"ok": True, "model": str(MODEL_DIR)})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/ner":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
            text = str(body.get("text") or "")
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(400, {"error": "invalid json"})
            return
        self._json(200, {"text": text, "entities": predict(text)})


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"listening on http://{HOST}:{PORT}", flush=True)
    httpd.serve_forever()
