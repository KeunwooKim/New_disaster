#!/usr/bin/env python3
"""HangJeongDong + 재난문자에서 행정구역 사전을 만듭니다."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEOJSON = Path("/tmp/hangjeong/hd.geojson")
SMS = ROOT / "data" / "raw" / "disaster-sms.jsonl"
OUT = ROOT / "data" / "gazetteer" / "admin.json"

SIDO_ALIAS = {
    "서울특별시": ["서울", "서울시"],
    "부산광역시": ["부산", "부산시"],
    "대구광역시": ["대구", "대구시"],
    "인천광역시": ["인천", "인천시"],
    "광주광역시": ["광주"],
    "대전광역시": ["대전", "대전시"],
    "울산광역시": ["울산", "울산시"],
    "세종특별자치시": ["세종", "세종시"],
    "경기도": ["경기"],
    "강원특별자치도": ["강원", "강원도"],
    "충청북도": ["충북"],
    "충청남도": ["충남"],
    "전북특별자치도": ["전북", "전라북도"],
    "전남광주통합특별시": ["전라남도", "전남", "광주광역시"],
    "경상북도": ["경북"],
    "경상남도": ["경남"],
    "제주특별자치도": ["제주", "제주도"],
}

COMPOUND_SGG = re.compile(r"^(.+시)(.+구)$")
RI_NEAR_EUP = re.compile(r"([가-힣]{1,10}(?:읍|면))\s*([가-힣]{1,10}리)")
SENDER_RE = re.compile(r"\[([^\[\]\n]{1,30})\]\s*$")


def split_sgg_token(token: str) -> list[str]:
    match = COMPOUND_SGG.match(token)
    if match:
        return [match.group(1), match.group(2)]
    return [token]


def load_hangjeong(path: Path) -> tuple[list[dict], list[dict], list[dict]]:
    text = path.read_text(encoding="utf-8")
    names = re.findall(r'"adm_nm"\s*:\s*"([^"]+)"', text)
    sido_set: dict[str, None] = {}
    sgg_map: dict[tuple[str, str], dict] = {}
    emd_map: dict[tuple[str, str, str], dict] = {}
    for raw in names:
        parts = raw.replace("·", " ").split()
        if len(parts) < 2:
            continue
        sido = parts[0]
        sido_set[sido] = None
        sgg_tokens = split_sgg_token(parts[1])
        city = sgg_tokens[0]
        sgg_name = sgg_tokens[-1]
        sgg_map[(sido, city)] = {"name": city, "sido": sido}
        if len(sgg_tokens) == 2:
            sgg_map[(sido, sgg_name)] = {"name": sgg_name, "sido": sido, "parentSi": city}
            compound = city + sgg_name
            sgg_map[(sido, compound)] = {"name": compound, "sido": sido, "parentSi": city}
        emd_name = parts[-1]
        emd_map[(sido, sgg_name, emd_name)] = {
            "name": emd_name,
            "sgg": sgg_name,
            "sido": sido,
            "parentSi": city if city != sgg_name else None,
        }
    sido = [{"name": name, "aliases": SIDO_ALIAS.get(name, [])} for name in sido_set]
    return sido, list(sgg_map.values()), list(emd_map.values())


def load_ri_from_sms(path: Path, emd: list[dict]) -> list[dict]:
    emd_index = defaultdict(list)
    for row in emd:
        emd_index[row["name"]].append(row)
    seen: dict[tuple[str, str, str, str], dict] = {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            rec = json.loads(line)
            title = rec.get("title") or ""
            sender = rec.get("sender") or ""
            for eup, ri in RI_NEAR_EUP.findall(title):
                parents = emd_index.get(eup, [])
                if sender:
                    scoped = [p for p in parents if sender in (p["sgg"], p.get("parentSi") or "", p["sido"])]
                    if scoped:
                        parents = scoped
                if not parents:
                    parents = [{"name": eup, "sgg": sender or "", "sido": "", "parentSi": None}]
                parent = parents[0]
                key = (parent["sido"], parent["sgg"], eup, ri)
                if key not in seen:
                    seen[key] = {
                        "name": ri,
                        "emd": eup,
                        "sgg": parent["sgg"],
                        "sido": parent["sido"],
                    }
    return list(seen.values())


def main() -> None:
    if not GEOJSON.exists():
        raise SystemExit(f"missing {GEOJSON}; download HangJeongDong first")
    sido, sgg, emd = load_hangjeong(GEOJSON)
    ri = load_ri_from_sms(SMS, emd) if SMS.exists() else []
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "HangJeongDong_ver20260701 + disaster-sms 리 패턴",
        "sido": sido,
        "sgg": sgg,
        "emd": emd,
        "ri": ri,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sgg_names = Counter(row["name"] for row in sgg)
    emd_names = Counter(row["name"] for row in emd)
    print(
        json.dumps(
            {
                "out": str(OUT),
                "bytes": OUT.stat().st_size,
                "sido": len(sido),
                "sgg": len(sgg),
                "emd": len(emd),
                "ri": len(ri),
                "ambiguous_sgg": [n for n, c in sgg_names.items() if c > 1],
                "ambiguous_emd_top": emd_names.most_common(8),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
