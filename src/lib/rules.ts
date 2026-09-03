import { createHash } from "node:crypto";
import {
  adminSenderNames,
  gazetteerLocations,
  isSpuriousLocationToken,
  locationFitsSenders,
  unambiguousAdminSenders,
} from "./gazetteer";
import { SGG_CENTROIDS } from "./sgg-centroids";
import { mergeStreetLocations } from "./street";
import type { EventSource, LlmAnalysis, Severity } from "./types";

const TYPE_KEYWORDS: Array<{ type: string; keys: string[]; severity: Severity }> = [
  { type: "민방공", keys: ["민방공", "공습경보", "경계경보"], severity: "critical" },
  { type: "지진", keys: ["지진", "여진"], severity: "critical" },
  { type: "산사태", keys: ["산사태"], severity: "high" },
  {
    type: "호우",
    keys: ["호우", "폭우", "침수", "홍수", "소나기", "많은 비", "많은비", "강한 비", "강우", "비가 많이", "하수 역류", "빗물", "물이 차오"],
    severity: "high",
  },
  { type: "태풍", keys: ["태풍"], severity: "high" },
  { type: "풍랑", keys: ["너울", "이안류", "풍랑", "연안사고"], severity: "high" },
  { type: "강풍", keys: ["강풍주의보", "강풍경보", "강풍"], severity: "high" },
  { type: "대설", keys: ["대설", "폭설"], severity: "high" },
  { type: "한파", keys: ["한파"], severity: "medium" },
  { type: "폭염", keys: ["폭염", "온열", "열대야", "무더위", "무더운", "덥고", "더위", "더울", "최고기온", "기온이 높"], severity: "medium" },
  { type: "산불", keys: ["산불"], severity: "high" },
  { type: "구제역", keys: ["구제역"], severity: "high" },
  { type: "미세먼지", keys: ["미세먼지", "황사"], severity: "low" },
  { type: "정전", keys: ["정전"], severity: "medium" },
  { type: "화재", keys: ["화재", "폭발사고", "가스폭발"], severity: "high" },
  { type: "실종", keys: ["실종", "찾아주세요", "목격", "인상착의", "치매", "가출인", "배회중", "찾습니다"], severity: "high" },
  { type: "물놀이", keys: ["물놀이", "구명조끼"], severity: "medium" },
  {
    type: "교통",
    keys: [
      "교통통제",
      "도로통제",
      "교통사고",
      "교통정체",
      "교통 혼잡",
      "교통이 혼잡",
      "감속 운전",
      "감속운행",
      "통행제한",
      "통행 제한",
      "통제중",
      "통제 중",
      "통제로",
      "우회도로",
      "도로 결빙",
      "통제해제",
      "통제 해제",
      "통제가 해제",
      "부분통제",
      "차단 해제",
      "정상 통행",
      "하상도로",
      "잠수교",
      "지하차도",
      "고속도로",
      "도로 통제",
      "차량 통제",
      "교통 통제",
      "통제하오니",
      "통제하니",
    ],
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

function dropContainedLocations(locations: string[]): string[] {
  const compact = (name: string) => name.replace(/\s+/g, "");
  const best = new Map<string, string>();
  for (const loc of locations) {
    const key = compact(loc);
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || loc.length > prev.length) best.set(key, loc);
  }
  const deduped = [...best.values()];
  return deduped.filter((loc) => {
    const tight = compact(loc);
    const parts = loc.split(/\s+/).filter(Boolean);
    return !deduped.some((other) => {
      if (other === loc) return false;
      const otherTight = compact(other);
      if (otherTight.includes(tight) && otherTight.length > tight.length) return true;
      const otherParts = other.split(/\s+/).filter(Boolean);
      return parts.every((part) => otherParts.includes(part)) && otherParts.length > parts.length;
    });
  });
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
  if (found.size === 0) {
    for (const sender of unambiguousAdminSenders(text)) found.add(sender);
    const matches = text.match(REGION_TOKEN) ?? [];
    for (const match of matches) found.add(match.trim());
  }
  return dropContainedLocations(
    dropCoarseParents(
      mergeStreetLocations(
        text,
        [...found]
          .map((item) => canonLocation(item, text))
          .filter((item): item is string => Boolean(item)),
      ),
    ),
  );
}

export function canonLocation(item: string, text = ""): string | null {
  let loc = item
    .replace(/전남광주통합특별시/g, "전라남도")
    .replace(/전남광주(?=\s|$)/g, "전라남도")
    .replace(/\s+/g, " ")
    .trim();
  if (!loc) return null;
  loc = loc
    .replace(/^서울(?=\s)/, "서울특별시")
    .replace(/^부산(?=\s)/, "부산광역시")
    .replace(/^대구(?=\s)/, "대구광역시")
    .replace(/^인천(?=\s)/, "인천광역시")
    .replace(/^대전(?=\s)/, "대전광역시")
    .replace(/^울산(?=\s)/, "울산광역시")
    .replace(/^세종(?=\s)/, "세종특별자치시")
    .replace(/^제주(?=\s)/, "제주특별자치도")
    .replace(/^경기(?=\s)/, "경기도")
    .replace(/^강원(?=\s)/, "강원특별자치도")
    .replace(/^강원도(?=\s)/, "강원특별자치도")
    .replace(/^충북(?=\s)/, "충청북도")
    .replace(/^충남(?=\s)/, "충청남도")
    .replace(/^전북(?=\s)/, "전북특별자치도")
    .replace(/^전라북도(?=\s)/, "전북특별자치도")
    .replace(/^전남(?=\s)/, "전라남도")
    .replace(/^경북(?=\s)/, "경상북도")
    .replace(/^경남(?=\s)/, "경상남도")
    .replace(/([가-힣]+시)\s+\1/g, "$1");
  if (loc === "서울") return "서울특별시";
  if (loc === "부산") return "부산광역시";
  if (loc === "대구") return "대구광역시";
  if (loc === "인천") return "인천광역시";
  if (loc === "대전") return "대전광역시";
  if (loc === "울산") return "울산광역시";
  if (loc === "세종") return "세종특별자치시";
  if (loc === "충북") return "충청북도";
  if (loc === "충남") return "충청남도";
  if (loc === "전북") return "전북특별자치도";
  if (loc === "전남") return "전라남도";
  if (loc === "경북") return "경상북도";
  if (loc === "경남") return "경상남도";
  if (loc === "경기") return "경기도";
  if (loc === "강원") return "강원특별자치도";
  if (loc === "제주" || loc === "제주도") return "제주특별자치도";
  if (loc === "서울시") loc = "서울특별시";
  if (loc === "부산시") loc = "부산광역시";
  if (loc === "대구시") loc = "대구광역시";
  if (loc === "인천시") loc = "인천광역시";
  if (loc === "대전시") loc = "대전광역시";
  if (loc === "울산시") loc = "울산광역시";
  if (loc === "세종시") loc = "세종특별자치시";
  if (loc === "광주") {
    if (/광주시/.test(text) && !/광주광역시/.test(text)) return "경기도 광주시";
    return "광주광역시";
  }
  loc = loc
    .replace(/\s*[가-힣]{1,6}구(?=\s|$)/g, (match) => {
      const gu = match.trim();
      const known = gu in SGG_CENTROIDS || Object.keys(SGG_CENTROIDS).some((key) => key.endsWith(` ${gu}`));
      return known ? match : "";
    })
    .replace(/\s+/g, " ")
    .trim();
  return loc || null;
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

export function cleanLocationList(items: string[], text = ""): string[] {
  const senders = adminSenderNames(text);
  const canon = [
    ...new Set(items.map((item) => canonLocation(item, text)).filter((item): item is string => Boolean(item))),
  ].filter((loc) => locationFitsSenders(loc, senders));
  const filled =
    canon.length > 0
      ? canon
      : unambiguousAdminSenders(text)
          .map((item) => canonLocation(item, text))
          .filter((item): item is string => Boolean(item));
  return dropContainedLocations(
    dropCoarseParents(mergeStreetLocations(text, filled)).filter((loc) => !isSpuriousLocationToken(loc)),
  );
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
  const extras =
    type === "지진"
      ? []
      : source === "missing"
        ? [text.match(/발생장소\s*([^.]*)/)?.[1]?.trim()].filter((item): item is string => Boolean(item))
        : knownRegions.filter((item) => {
            const token = item.trim().split(/\s+/).pop() ?? "";
            return /(특별자치시|광역시|특별시|특별자치도|시|군|구|읍|면|동)$/.test(token);
          });
  const locations = cleanLocationList(extractRegions(text, extras), text);
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
