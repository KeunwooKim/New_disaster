import { resolveSggInSido } from "./gazetteer";
import {
  fetchPortalJson,
  parseKstDigits,
  pickString,
  portalItems,
  portalResult,
  type PortalEvent,
} from "./portal";

const ENDPOINT = "https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnStatus";

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

const SIDO_PATTERN = new RegExp(`(${SIDO_NAMES.join("|")})\\s*(?:\\(([^)]*)\\))?`, "g");

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
  강원: "강원도",
  강원도: "강원도",
};

function skipToken(token: string): boolean {
  return /바다|해상|초도|홍도|\./.test(token);
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

function cleanPlace(token: string): string | null {
  let name = token.replace(/\([^()]*\)/g, "").replace(/\s+/g, "").trim();
  if (!name || skipToken(name)) return null;
  name = stripSector(name);
  if (!name || skipToken(name)) return null;
  if (name.startsWith("서귀포")) return "서귀포시";
  if (name.startsWith("제주")) return "제주시";
  if (name === "창원") return "창원시";
  if (/(시|군|구)$/.test(name)) return name;
  return name;
}

function expandAreas(blob: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (label: string) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    found.push(label);
  };

  const cleaned = blob.replace(/\([^()]*제외[^()]*\)/g, "");
  for (const match of cleaned.matchAll(SIDO_PATTERN)) {
    const sido = match[1];
    const inner = match[2];
    const sidoLabel = displaySido(sido);
    if (inner != null && inner.trim()) {
      for (const part of inner.split(/,/)) {
        const place = cleanPlace(part);
        if (!place) continue;
        const resolved = resolveSggInSido(sido, place);
        if (resolved.length > 0) {
          for (const sgg of resolved) push(`${sidoLabel} ${sgg}`);
        } else if (/(시|군|구)$/.test(place)) {
          push(`${sidoLabel} ${place}`);
        }
      }
      continue;
    }
    push(sidoLabel);
  }
  return found;
}

function parseStatusBlocks(text: string): Array<{ title: string; regions: string[] }> {
  const blocks: Array<{ title: string; regions: string[] }> = [];
  const re = /o\s*([^:\n]+)\s*:\s*([^\n]+)/g;
  for (const match of text.matchAll(re)) {
    const title = match[1].trim();
    const regions = expandAreas(match[2]);
    if (!title || regions.length === 0) continue;
    blocks.push({ title, regions });
  }
  return blocks;
}

export async function fetchWeatherWarnings(serviceKey: string): Promise<PortalEvent[]> {
  const payload = await fetchPortalJson(ENDPOINT, serviceKey, { pageNo: "1", numOfRows: "10" });
  const { code, msg } = portalResult(payload);
  if (code && code !== "00") {
    if (code === "03" || code === "11") return [];
    throw new Error(`특보현황 ${code}: ${msg || "unknown"}`);
  }

  const events: PortalEvent[] = [];
  for (const row of portalItems(payload)) {
    const tmFc = pickString(row, ["tmFc"]);
    const t6 = pickString(row, ["t6"]);
    const occurredAt = parseKstDigits(tmFc);
    for (const block of parseStatusBlocks(t6)) {
      const slug = block.title.replace(/\s+/g, "");
      events.push({
        id: `kma-wrn:${tmFc || "now"}:${slug}`,
        occurredAt,
        rawText: `${block.title} 발효. ${block.regions.join(", ")}`,
        regions: block.regions,
        raw: { ...row, wrnTitle: block.title },
      });
    }
  }
  return events;
}
