import { createHash } from "node:crypto";
import { gazetteerLocations } from "./gazetteer";
import type { EventSource, LlmAnalysis, Severity } from "./types";

const TYPE_KEYWORDS: Array<{ type: string; keys: string[]; severity: Severity }> = [
  { type: "민방공", keys: ["민방공", "공습경보", "경계경보"], severity: "critical" },
  { type: "지진", keys: ["지진", "여진"], severity: "critical" },
  { type: "산사태", keys: ["산사태"], severity: "high" },
  { type: "호우", keys: ["호우", "폭우", "침수", "홍수"], severity: "high" },
  { type: "태풍", keys: ["태풍"], severity: "high" },
  { type: "대설", keys: ["대설", "폭설"], severity: "high" },
  { type: "한파", keys: ["한파"], severity: "medium" },
  { type: "폭염", keys: ["폭염", "온열", "열대야"], severity: "medium" },
  { type: "산불", keys: ["산불"], severity: "high" },
  { type: "미세먼지", keys: ["미세먼지", "황사"], severity: "low" },
  { type: "정전", keys: ["정전"], severity: "medium" },
  { type: "화재", keys: ["화재", "폭발"], severity: "high" },
  { type: "실종", keys: ["실종", "찾아주세요", "목격", "인상착의", "치매", "가출인"], severity: "high" },
  {
    type: "교통",
    keys: ["교통통제", "도로통제", "교통사고", "교통정체", "통행제한", "통행 제한", "통제중", "통제해제", "하상도로", "잠수교"],
    severity: "medium",
  },
];

const REGION_TOKEN =
  /(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|제주특별자치도|강원특별자치도|전북특별자치도|전남광주|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|서울|부산|대구|인천|광주|대전|울산|세종|제주|경기|강원|충북|충남|전북|전남|경북|경남)(?:\s*[가-힣]+(?:시|군|구))?/g;

export function classifyDisasterType(text: string): { type: string; severity: Severity } {
  for (const row of TYPE_KEYWORDS) {
    if (row.keys.some((key) => text.includes(key))) {
      return { type: row.type, severity: row.severity };
    }
  }
  return { type: "기타", severity: "medium" };
}

export function extractRegions(text: string, extra: string[] = []): string[] {
  const found = new Set<string>();
  try {
    for (const item of gazetteerLocations(text, extra)) found.add(item);
  } catch {
    for (const item of extra) {
      for (const part of item.split(/[,/·]/)) {
        const trimmed = part.trim();
        if (trimmed) found.add(trimmed);
      }
    }
  }
  const matches = text.match(REGION_TOKEN) ?? [];
  for (const match of matches) {
    const trimmed = match.trim();
    if (trimmed === "광주" && /광주시/.test(text) && !/광주광역시|전남광주/.test(text)) continue;
    found.add(trimmed);
  }
  return dropCoarseParents([...found]);
}

function dropCoarseParents(locations: string[]): string[] {
  const last = (name: string) => name.trim().split(/\s+/).pop() ?? "";
  const hasFine = locations.some((name) => {
    const token = last(name);
    return /[시군구]$/.test(token) && !/(특별시|광역시|특별자치시)$/.test(token);
  });
  if (!hasFine) return locations;
  return locations.filter((name) => !/(특별자치도|광역시|특별시|도)$/.test(last(name)));
}

export function parseCbsByRules(
  text: string,
  knownRegions: string[] = [],
  source?: EventSource,
): LlmAnalysis {
  const classified = classifyDisasterType(text);
  const type =
    source === "missing"
      ? "실종"
      : source === "eqk"
        ? "지진"
        : source === "typhoon"
          ? "태풍"
          : source === "landslide"
            ? "산사태"
            : classified.type;
  const severity =
    source === "missing" || source === "eqk" || source === "typhoon" || source === "landslide"
      ? "high"
      : classified.severity;
  const extras = type === "지진" ? [] : knownRegions;
  const locations = dropCoarseParents([
    ...new Set(
      extractRegions(text, extras)
        .map((item) =>
          item
            .replace(/전남광주통합특별시/g, "전라남도")
            .replace(/전남광주(?=\s|$)/g, "전라남도")
            .trim(),
        )
        .filter(Boolean),
    ),
  ]);
  const summary = text.replace(/\s+/g, " ").trim().slice(0, 180);
  const actions =
    type === "실종"
      ? "인상착의를 확인하고 목격 시 112에 제보하세요."
      : type === "호우" || type === "태풍"
        ? "위험지역에서 대피하고 외출을 자제하세요."
        : type === "지진"
          ? "책상 아래로 대피한 뒤 진동이 멈추면 밖으로 이동하세요."
          : "안내 문자를 확인하고 지시에 따르세요.";

  const clothes = text.match(/착의\s*([^.]*)/)?.[1]?.trim();
  const appearance = text.match(/특징\s*([^.]*)/)?.[1]?.trim();

  return {
    disasterType: type,
    locations,
    severity,
    summary,
    actions,
    appearance: type === "실종" ? appearance : undefined,
    clothing: type === "실종" ? clothes : undefined,
    lastSeen: type === "실종" ? locations[0] : undefined,
  };
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
