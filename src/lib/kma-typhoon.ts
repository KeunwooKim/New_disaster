import {
  fetchPortalJson,
  parseKstDigits,
  pickNumber,
  pickString,
  portalItems,
  portalResult,
  ymdSeoul,
  type PortalEvent,
} from "./portal";

const ENDPOINT = "https://apis.data.go.kr/1360000/TyphoonInfoService/getTyphoonInfo";

export async function fetchTyphoons(serviceKey: string): Promise<PortalEvent[]> {
  const payload = await fetchPortalJson(ENDPOINT, serviceKey, {
    pageNo: "1",
    numOfRows: "40",
    fromTmFc: ymdSeoul(2),
    toTmFc: ymdSeoul(0),
  });
  const { code, msg } = portalResult(payload);
  if (code && code !== "00") {
    if (code === "03" || code === "11") return [];
    throw new Error(`태풍 ${code}: ${msg || "unknown"}`);
  }

  const latest = new Map<string, Record<string, unknown>>();
  for (const row of portalItems(payload)) {
    const seq = pickString(row, ["typSeq"]);
    const tm = pickString(row, ["typTm", "tmFc"]);
    if (!seq) continue;
    const prev = latest.get(seq);
    if (!prev || pickString(prev, ["typTm", "tmFc"]) <= tm) latest.set(seq, row);
  }

  const events: PortalEvent[] = [];
  for (const row of latest.values()) {
    const seq = pickString(row, ["typSeq"]);
    const tmFc = pickString(row, ["tmFc"]);
    const name = pickString(row, ["typName"]);
    const loc = pickString(row, ["typLoc"]);
    const ws = pickString(row, ["typWs"]);
    const ps = pickString(row, ["typPs"]);
    const rem = pickString(row, ["rem"]);
    const lat = pickNumber(row, ["typLat"]);
    const lng = pickNumber(row, ["typLon"]);
    if (lat == null || lng == null) continue;
    const parts = [
      name ? `제${seq}호 태풍 ${name}` : `제${seq}호 태풍`,
      loc || null,
      ws ? `최대풍속 ${ws}m/s` : null,
      ps ? `중심기압 ${ps}hPa` : null,
      rem?.split("|")[0] || null,
    ].filter(Boolean);
    events.push({
      id: `typhoon:${seq}:${tmFc || seq}`,
      occurredAt: parseKstDigits(pickString(row, ["typTm", "tmFc"])),
      rawText: parts.join(". ") + ".",
      regions: loc ? [loc] : [],
      raw: row,
      lat,
      lng,
    });
  }
  return events;
}
