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

const ENDPOINT = "https://apis.data.go.kr/1360000/EqkInfoService/getEqkMsg";

export async function fetchEarthquakes(serviceKey: string): Promise<PortalEvent[]> {
  const payload = await fetchPortalJson(ENDPOINT, serviceKey, {
    pageNo: "1",
    numOfRows: "20",
    fromTmFc: ymdSeoul(3),
    toTmFc: ymdSeoul(0),
  });
  const { code, msg } = portalResult(payload);
  if (code && code !== "00") {
    if (code === "03" || code === "11") return [];
    throw new Error(`지진 ${code}: ${msg || "unknown"}`);
  }

  const events: PortalEvent[] = [];
  for (const row of portalItems(payload)) {
    const tmEqk = pickString(row, ["tmEqk"]);
    const loc = pickString(row, ["loc"]);
    const mt = pickString(row, ["mt"]);
    const rem = pickString(row, ["rem"]);
    const inT = pickString(row, ["inT"]);
    const lat = pickNumber(row, ["lat"]);
    const lng = pickNumber(row, ["lon"]);
    if (!tmEqk || lat == null || lng == null) continue;
    const parts = [
      loc ? `진앙 ${loc}` : null,
      mt ? `규모 ${mt}` : null,
      inT || null,
      rem || null,
    ].filter(Boolean);
    events.push({
      id: `eqk:${tmEqk}`,
      occurredAt: parseKstDigits(tmEqk),
      rawText: parts.join(". ") + ".",
      regions: loc ? [loc] : [],
      raw: row,
      lat,
      lng,
    });
  }
  return events;
}
