import { resolveSggInSido } from "./gazetteer";
import {
  fetchPortalJson,
  parseKstDigits,
  pickString,
  portalItems,
  portalResult,
  type PortalEvent,
} from "./portal";
import type { Severity } from "./types";

const STATUS_URL = "https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnStatus";
const MSG_URL = "https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnMsg";
const CD_URL = "https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnCd";

const SIDO_NAMES = [
  "제주특별자치도",
  "세종특별자치시",
  "강원특별자치도",
  "전북특별자치도",
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "충청북도",
  "충청남도",
  "전라북도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주도",
  "경기도",
  "강원도",
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "제주",
].sort((a, b) => b.length - a.length);

const SECTOR_SUFFIX = ["동남부", "남동부", "북부", "남부", "중부", "동부", "서부", "평지"];

const SIDO_DISPLAY: Record<string, string> = {
  서울: "서울특별시",
  부산: "부산광역시",
  대구: "대구광역시",
  인천: "인천광역시",
  광주: "광주광역시",
  대전: "대전광역시",
  울산: "울산광역시",
  세종: "세종특별자치시",
  제주: "제주특별자치도",
  제주도: "제주특별자치도",
  경기: "경기도",
  강원: "강원특별자치도",
  강원도: "강원특별자치도",
};

const WRN_TYPES: Array<{ type: string; keys: string[]; actions: string }> = [
  { type: "태풍", keys: ["태풍"], actions: "외출을 자제하고 시설물을 점검하세요." },
  { type: "호우", keys: ["호우"], actions: "하천·급경사지 등 위험지역에 접근하지 마세요." },
  { type: "대설", keys: ["대설"], actions: "대중교통을 이용하고 빙판길에 주의하세요." },
  { type: "강풍", keys: ["강풍"], actions: "간판·시설물 낙하에 주의하고 외출을 줄이세요." },
  { type: "풍랑", keys: ["풍랑", "폭풍해일"], actions: "해안가·방파제에 접근하지 마세요." },
  { type: "한파", keys: ["한파"], actions: "동파·한랭질환에 주의하세요." },
  { type: "폭염", keys: ["폭염", "열대야"], actions: "한낮 야외활동을 줄이고 물을 자주 마시세요." },
  { type: "건조", keys: ["건조"], actions: "화재에 주의하고 산림 인접 작업을 삼가세요." },
  { type: "미세먼지", keys: ["황사"], actions: "외출 시 마스크를 쓰고 환기를 줄이세요." },
];

export function classifyWrnTitle(title: string): { type: string; severity: Severity; actions: string } {
  const level = /경보/.test(title) ? "high" : /예비/.test(title) ? "low" : "medium";
  for (const row of WRN_TYPES) {
    if (row.keys.some((key) => title.includes(key))) {
      return { type: row.type, severity: level, actions: row.actions };
    }
  }
  return { type: "기타", severity: level, actions: "기상청 특보 안내를 확인하고 지시에 따르세요." };
}

function splitTop(text: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function isSeaToken(token: string): boolean {
  return /바다|해상/.test(token);
}

function skipPlace(token: string): boolean {
  return /초도|홍도|\./.test(token);
}

function stripSector(name: string): string {
  for (const suffix of SECTOR_SUFFIX) {
    if (name.endsWith(suffix) && name.length - suffix.length >= 2) {
      return name.slice(0, -suffix.length);
    }
  }
  return name;
}

function displaySido(sido: string): string {
  return SIDO_DISPLAY[sido] ?? sido;
}

function formatSgg(sgg: string): string {
  return sgg.replace(/^([가-힣]+시)([가-힣]+구)$/, "$1 $2");
}

function matchSidoChunk(chunk: string): { sido: string; inner: string | null } | null {
  const trimmed = chunk.trim();
  for (const name of SIDO_NAMES) {
    if (!trimmed.startsWith(name)) continue;
    const rest = trimmed.slice(name.length).trim();
    if (!rest) return { sido: name, inner: null };
    if (rest.startsWith("(") && rest.endsWith(")")) {
      return { sido: name, inner: rest.slice(1, -1) };
    }
    return null;
  }
  return null;
}

function cleanPlace(token: string): string | null {
  let name = token.replace(/\([^()]*제외[^()]*\)/g, "").replace(/\([^()]*\)/g, "").replace(/\s+/g, "").trim();
  if (!name || isSeaToken(name) || skipPlace(name)) return null;
  name = stripSector(name);
  if (!name || isSeaToken(name) || skipPlace(name)) return null;
  if (name.startsWith("서귀포")) return "서귀포시";
  if (name.startsWith("제주")) return "제주시";
  if (name === "창원") return "창원시";
  if (/(시|군|구)$/.test(name)) return name;
  return name;
}

function labelsForPlace(sidoHint: string, sidoLabel: string, place: string): string[] {
  const resolved = resolveSggInSido(sidoHint, place);
  if (resolved.length === 0) {
    return /(시|군|구)$/.test(place) ? [`${sidoLabel} ${formatSgg(place)}`] : [];
  }
  const districts = resolved.filter((name) => /구$/.test(name));
  if (districts.length > 1) {
    const city = resolved.find((name) => /시$/.test(name) && !/구$/.test(name)) ?? place;
    return [`${sidoLabel} ${formatSgg(city)}`];
  }
  return resolved.map((sgg) => `${sidoLabel} ${formatSgg(sgg)}`);
}

export function expandWrnAreas(blob: string): { land: string[]; sea: string[] } {
  const land: string[] = [];
  const sea: string[] = [];
  const seen = new Set<string>();
  const pushLand = (label: string) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    land.push(label);
  };

  for (const chunk of splitTop(blob.replace(/\s+/g, " "))) {
    if (isSeaToken(chunk)) {
      sea.push(chunk);
      continue;
    }
    const matched = matchSidoChunk(chunk);
    if (!matched) continue;
    const sidoLabel = displaySido(matched.sido);
    if (matched.inner == null) {
      pushLand(sidoLabel);
      continue;
    }
    for (const part of splitTop(matched.inner)) {
      const place = cleanPlace(part);
      if (!place) continue;
      for (const label of labelsForPlace(matched.sido, sidoLabel, place)) pushLand(label);
    }
  }
  return { land, sea };
}

function parseStatusLines(text: string): Array<{ title: string; blob: string }> {
  const lines: Array<{ title: string; blob: string }> = [];
  const re = /o\s*([^:\n]+)\s*:\s*([^\n]+)/g;
  for (const match of text.matchAll(re)) {
    const title = match[1].trim();
    const blob = match[2].trim();
    if (title && blob) lines.push({ title, blob });
  }
  return lines;
}

function parsePwnGroups(text: string): Array<{ title: string; when: string; blob: string }> {
  const groups: Array<{ title: string; when: string; blob: string }> = [];
  const chunks = text.split(/\(\d+\)\s*/).map((item) => item.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const header = chunk.split(/\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
    const kind = header.replace(/\s*예비특보.*$/, "").trim() || header;
    const title = `${kind} 예비특보`;
    for (const line of parseStatusLines(chunk)) {
      groups.push({ title, when: line.title, blob: line.blob });
    }
  }
  return groups;
}

function regionSummary(land: string[], sea: string[]): string {
  const landBit = land.length > 0 ? land.join(", ") : "";
  const seaBit = sea.length > 0 ? `해상 ${sea.join(", ")}` : "";
  return [landBit, seaBit].filter(Boolean).join(". ");
}

function buildSummary(title: string, land: string[], sea: string[], extra: string[]): string {
  const where = regionSummary(land, sea) || "해당 구역";
  const bits = [`${title} 발효. ${where}`, ...extra.filter(Boolean)];
  return bits.join(" · ").replace(/\s+/g, " ").trim().slice(0, 240);
}

async function fetchBulletin(serviceKey: string, tmFc: string, tmSeq: string): Promise<Record<string, unknown> | null> {
  if (!tmFc || !tmSeq) return null;
  const ymd = tmFc.replace(/\D/g, "").slice(0, 8);
  try {
    const payload = await fetchPortalJson(MSG_URL, serviceKey, {
      pageNo: "1",
      numOfRows: "1",
      stnId: "108",
      fromTmFc: ymd,
      toTmFc: ymd,
      tmFc,
      tmSeq,
    });
    const { code } = portalResult(payload);
    if (code && code !== "00") return null;
    return portalItems(payload)[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchPwnCodes(serviceKey: string): Promise<Array<Record<string, unknown>>> {
  try {
    const payload = await fetchPortalJson(CD_URL, serviceKey, { pageNo: "1", numOfRows: "200" });
    const { code } = portalResult(payload);
    if (code && code !== "00") return [];
    return portalItems(payload);
  } catch {
    return [];
  }
}

function noticesFor(title: string, bulletin: Record<string, unknown> | null): string[] {
  if (!bulletin) return [];
  const t1 = pickString(bulletin, ["t1"]);
  const head = title.match(/^[가-힣]+/)?.[0] ?? "";
  if (head && t1 && !t1.includes(head)) return [];
  const t3 = pickString(bulletin, ["t3"]).replace(/\s+/g, " ").trim();
  const t4 = pickString(bulletin, ["t4"]).replace(/\s+/g, " ").trim();
  const out: string[] = [];
  const when = t3.match(/\d{4}년[^|]{0,40}/)?.[0]?.trim();
  if (when) out.push(`발효 ${when}`);
  const until = t4.match(/해제\s*예고\s*:\s*([^|]+)/)?.[1]?.trim();
  if (until) out.push(`해제 예고 ${until.replace(/\s+/g, " ").slice(0, 40)}`);
  return out;
}

export async function fetchWeatherWarnings(serviceKey: string): Promise<PortalEvent[]> {
  const payload = await fetchPortalJson(STATUS_URL, serviceKey, { pageNo: "1", numOfRows: "10" });
  const { code, msg } = portalResult(payload);
  if (code && code !== "00") {
    if (code === "03" || code === "11") return [];
    throw new Error(`특보현황 ${code}: ${msg || "unknown"}`);
  }

  const events: PortalEvent[] = [];
  for (const row of portalItems(payload)) {
    const tmFc = pickString(row, ["tmFc"]);
    const tmSeq = pickString(row, ["tmSeq"]);
    const t6 = pickString(row, ["t6"]);
    const t7 = pickString(row, ["t7"]);
    const occurredAt = parseKstDigits(tmFc);
    const [bulletin, codes] = await Promise.all([fetchBulletin(serviceKey, tmFc, tmSeq), fetchPwnCodes(serviceKey)]);

    for (const line of parseStatusLines(t6)) {
      const { land, sea } = expandWrnAreas(line.blob);
      if (land.length === 0 && sea.length === 0) continue;
      const slug = line.title.replace(/\s+/g, "");
      const extra = noticesFor(line.title, bulletin);
      const summary = buildSummary(line.title, land, sea, extra);
      events.push({
        id: `kma-wrn:${tmFc || "now"}:${slug}`,
        occurredAt,
        rawText: summary,
        regions: land,
        raw: {
          ...row,
          wrnTitle: line.title,
          wrnSummary: summary,
          wrnSea: sea,
          wrnCodes: codes.filter((item) => String(item.areaName ?? "").length > 0),
        },
      });
    }

    const pwnByTitle = new Map<string, { land: string[]; sea: string[]; when: string[] }>();
    for (const group of parsePwnGroups(t7)) {
      const { land, sea } = expandWrnAreas(group.blob);
      const rowPwn = pwnByTitle.get(group.title) ?? { land: [], sea: [], when: [] };
      for (const loc of land) if (!rowPwn.land.includes(loc)) rowPwn.land.push(loc);
      for (const loc of sea) if (!rowPwn.sea.includes(loc)) rowPwn.sea.push(loc);
      if (group.when && !rowPwn.when.includes(group.when)) rowPwn.when.push(group.when);
      pwnByTitle.set(group.title, rowPwn);
    }
    for (const [title, item] of pwnByTitle) {
      if (item.land.length === 0 && item.sea.length === 0) continue;
      const when = item.when.join(", ");
      const summary = `${title}${when ? ` · ${when}` : ""}. ${regionSummary(item.land, item.sea)}`
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);
      events.push({
        id: `kma-wrn:pwn:${tmFc || "now"}:${title.replace(/\s+/g, "")}`,
        occurredAt,
        rawText: summary,
        regions: item.land,
        raw: { ...row, wrnTitle: title, wrnSummary: summary, wrnSea: item.sea, wrnPwn: true },
      });
    }
  }
  return events;
}
