import {
  fetchPortalJson,
  parseKstDigits,
  pickString,
  portalItems,
  portalResult,
  type PortalEvent,
} from "./portal";

const ENDPOINT = "https://apis.data.go.kr/1400000/predictionInfoService/predictionInfoList";

async function latestByLevel(serviceKey: string, level: "주의보" | "경보"): Promise<PortalEvent | null> {
  const payload = await fetchPortalJson(ENDPOINT, serviceKey, {
    pageNo: "1",
    numOfRows: "200",
    _type: "json",
    lndslFrcstNm: level,
  });
  const { code, msg } = portalResult(payload);
  if (code && code !== "00") {
    if (code === "03" || code === "11") return null;
    throw new Error(`산사태 ${level} ${code}: ${msg || "unknown"}`);
  }
  const rows = portalItems(payload);
  if (rows.length === 0) return null;
  const latest = rows
    .map((row) => pickString(row, ["prctnInfoAnlssDt"]))
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!latest) return null;
  const regions = [
    ...new Set(
      rows
        .filter((row) => pickString(row, ["prctnInfoAnlssDt"]) === latest)
        .map((row) => pickString(row, ["sgg"]))
        .filter(Boolean),
    ),
  ];
  if (regions.length === 0) return null;
  const stamp = latest.replace(/\D/g, "").slice(0, 10);
  return {
    id: `landslide:${level}:${stamp}`,
    occurredAt: parseKstDigits(latest),
    rawText: `산사태 ${level} 예측. ${regions.join(", ")}`,
    regions,
    raw: { level, analyzedAt: latest, count: regions.length },
  };
}

export async function fetchLandslideForecasts(serviceKey: string): Promise<PortalEvent[]> {
  const events: PortalEvent[] = [];
  for (const level of ["경보", "주의보"] as const) {
    const event = await latestByLevel(serviceKey, level);
    if (event) events.push(event);
  }
  return events;
}
