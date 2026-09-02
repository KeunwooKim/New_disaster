#!/usr/bin/env python3
"""안전데이터 재난문자 목록 전량 수집."""

from __future__ import annotations

import csv
import html
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://www.safetydata.go.kr/disaster-data/disasterNotification"
UA = "urban-alert/0.1 (research archive; +https://www.safetydata.go.kr)"
ROW_RE = re.compile(
    r'cell-no">(?P<no>\d+)</td>\s*'
    r'<td[^>]*>\s*<a[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>'
    r'[\s\S]*?cell-date">(?P<date>[^<]+)</td>',
    re.S,
)
SN_RE = re.compile(r"sn=(\d+)")
SENDER_RE = re.compile(r"\[([^\]]+)\]\s*$")
TOTAL_RE = re.compile(r"총\s*([0-9,]+)\s*건")


def fetch(page: int, per_page: int) -> str:
    url = f"{BASE}?currentPage={page}&cntPerPage={per_page}&pageSize={per_page}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_rows(page_html: str) -> list[dict]:
    rows = []
    for match in ROW_RE.finditer(page_html):
        title = html.unescape(re.sub(r"\s+", " ", match.group("title"))).strip()
        href = html.unescape(match.group("href"))
        sn_match = SN_RE.search(href)
        sender_match = SENDER_RE.search(title)
        rows.append(
            {
                "no": int(match.group("no")),
                "sn": int(sn_match.group(1)) if sn_match else None,
                "title": title,
                "sender": sender_match.group(1) if sender_match else None,
                "registered_at": match.group("date").strip(),
                "url": "https://www.safetydata.go.kr" + href,
            }
        )
    return rows


def main() -> None:
    out_dir = Path(__file__).resolve().parents[1] / "data" / "raw"
    out_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = out_dir / "disaster-sms.jsonl"
    csv_path = out_dir / "disaster-sms.csv"
    meta_path = out_dir / "disaster-sms.meta.json"

    per_page = 1000
    first = fetch(1, per_page)
    total_match = TOTAL_RE.search(first)
    total = int(total_match.group(1).replace(",", "")) if total_match else 0
    pages = max(1, (total + per_page - 1) // per_page) if total else 80
    print(f"listed total={total} pages={pages} per_page={per_page}", flush=True)

    seen: set[int] = set()
    records: list[dict] = []
    page = 1
    html_page = first
    empty_streak = 0
    while page <= pages + 2:
        if page > 1:
            time.sleep(0.15)
            try:
                html_page = fetch(page, per_page)
            except urllib.error.URLError as exc:
                print(f"retry page={page} {exc}", flush=True)
                time.sleep(1.5)
                html_page = fetch(page, per_page)
        rows = parse_rows(html_page)
        new_rows = [row for row in rows if row["no"] not in seen]
        for row in new_rows:
            seen.add(row["no"])
        records.extend(new_rows)
        print(f"page={page}/{pages} got={len(rows)} unique={len(records)}", flush=True)
        if not rows:
            empty_streak += 1
            if empty_streak >= 2:
                break
        else:
            empty_streak = 0
            if total and len(records) >= total:
                break
        page += 1

    records.sort(key=lambda row: row["no"], reverse=True)
    with jsonl_path.open("w", encoding="utf-8") as fh:
        for row in records:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=["no", "sn", "registered_at", "sender", "title", "url"],
        )
        writer.writeheader()
        writer.writerows(records)
    meta = {
        "source": BASE,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "listed_total": total,
        "saved": len(records),
        "pages_fetched": page,
        "per_page": per_page,
        "jsonl": str(jsonl_path),
        "csv": str(csv_path),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
