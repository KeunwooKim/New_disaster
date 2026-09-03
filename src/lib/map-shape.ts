import { lookupCentroid } from "./region-centroids";
import type { AlertEvent } from "./types";

export type MapKind = "point" | "area";

export type MapShape = {
  key: string;
  kind: MapKind;
  lat: number;
  lng: number;
  radiusM: number;
  label: string;
};

const POINT_PLACE =
  /(\d+번길|번길|(?:대로|로|길)\s*\d+|로\d+|길\b|번지|아파트|학교|병원|역\b|터미널|IC|JC|나들목|고속도로|지하차도|잠수교|하상도로|교차로|터널|방파제|갯바위|해수욕장|저수지|계곡|공원|대교|\d+\s*K)/;

const WATCH_OR_FORECAST = /주의보|경보|특보|예보|발효|발령|해제/;
const WIDE_HAZARD = /호우|태풍|대설|한파|폭염|미세먼지|강풍|건조|풍랑|너울|해일|황사|지진|민방공|산사태|침수|무더위/;
const INCIDENT_POINT = /정전|통제해제|통제중|교통사고|화재|붕괴|유실|파손/;

function lastToken(name: string): string {
  return name.trim().split(/\s+/).pop() ?? name;
}

function isDongRi(name: string): boolean {
  return /[동리가]$/.test(lastToken(name));
}

function isAdminRegion(name: string): boolean {
  return /(?:특별자치도|특별자치시|광역시|특별시|도|시|군|구)$/.test(lastToken(name));
}

export function eventLocations(event: AlertEvent): string[] {
  const fromLlm = event.llm?.locations?.filter((item) => item.trim()) ?? [];
  const raw = fromLlm.length > 0 ? fromLlm : event.regions;
  const unique: string[] = [];
  for (const item of raw) {
    const trimmed = item.replace(/\s+/g, " ").trim();
    if (trimmed && !unique.includes(trimmed)) unique.push(trimmed);
  }
  return unique;
}

function dropCoarseParents(locations: string[]): string[] {
  const hasFine = locations.some((name) => {
    const token = lastToken(name);
    return /[시군구]$/.test(token) && !/(특별시|광역시|특별자치시)$/.test(token);
  });
  if (!hasFine) return locations;
  return locations.filter((name) => !/(특별자치도|광역시|특별시|도)$/.test(lastToken(name)));
}

function collapseSameCityDistricts(locations: string[]): string[] {
  if (locations.length < 3) return locations;
  const city = locations
    .map((name) => name.match(/([가-힣]+시)(?:\s|$)/)?.[1] ?? null)
    .find((item, _, all) => item && all.every((other) => other === item));
  if (!city || /특별시|광역시/.test(city)) return locations;
  if (locations.every((name) => name.includes(city) && /구$/.test(lastToken(name)))) {
    return [city];
  }
  return locations;
}

export function mapKindForEvent(event: AlertEvent): MapKind {
  if (event.source === "missing" || event.source === "eqk" || event.source === "typhoon") {
    return "point";
  }
  if (event.source === "kma_wrn" || event.source === "landslide") return "area";

  const locations = eventLocations(event);
  const text = event.rawText;
  const type = event.llm?.disasterType ?? "";
  if (type === "지진") return "point";
  const distinctCities = new Set(
    locations.map((name) => name.match(/([가-힣]+(?:시|군))/)?.[1]).filter(Boolean),
  );

  if (locations.some(isDongRi) || (INCIDENT_POINT.test(text) && POINT_PLACE.test(text))) {
    return "point";
  }
  if (distinctCities.size >= 2) return "area";
  if (WATCH_OR_FORECAST.test(text) || WIDE_HAZARD.test(type) || WIDE_HAZARD.test(text)) {
    return "area";
  }
  if (locations.length > 0 && locations.every((name) => isAdminRegion(name) && !isDongRi(name))) {
    return "area";
  }
  if (POINT_PLACE.test(text) || locations.some((name) => POINT_PLACE.test(name))) {
    return "point";
  }
  return locations.length > 0 ? "area" : "point";
}

export function areaRadiusM(location: string): number {
  const token = lastToken(location);
  if (/[읍면]$/.test(token)) return 4_000;
  if (/구$/.test(token)) return 4_500;
  if (/군$/.test(token)) return 16_000;
  if (/시$/.test(token) && !/특별시|광역시|특별자치시/.test(token)) return 11_000;
  if (/광역시|특별시|특별자치시/.test(location) && !/구$/.test(token)) return 20_000;
  if (/도$/.test(token) || /특별자치도/.test(location)) return 65_000;
  if (isDongRi(location)) return 1_200;
  return 10_000;
}

function coordsFor(location: string, fallback: [number, number] | null): [number, number] | null {
  return lookupCentroid(location) ?? fallback;
}

export function eventPoint(event: AlertEvent): [number, number] | null {
  if (event.lat != null && event.lng != null) return [event.lat, event.lng];
  const label = eventLocations(event)[0];
  return label ? lookupCentroid(label) : null;
}

export function shapesForEvent(event: AlertEvent): MapShape[] {
  const kind = mapKindForEvent(event);
  const fallback = eventPoint(event);

  if (kind === "point") {
    const label = eventLocations(event)[0] ?? "";
    const coords = fallback;
    if (!coords) return [];
    return [
      {
        key: event.id,
        kind: "point",
        lat: coords[0],
        lng: coords[1],
        radiusM: 0,
        label,
      },
    ];
  }

  const locations = collapseSameCityDistricts(dropCoarseParents(eventLocations(event))).slice(
    0,
    40,
  );
  const used = new Set<string>();
  const shapes: MapShape[] = [];

  const names = locations.length > 0 ? locations : [""];
  names.forEach((name, index) => {
    const coords = name ? coordsFor(name, index === 0 ? fallback : null) : fallback;
    if (!coords) return;
    const stamp = `${coords[0].toFixed(4)},${coords[1].toFixed(4)}`;
    if (used.has(stamp)) return;
    used.add(stamp);
    shapes.push({
      key: `${event.id}:${index}`,
      kind: "area",
      lat: coords[0],
      lng: coords[1],
      radiusM: areaRadiusM(name || "시"),
      label: name,
    });
  });

  if (shapes.length === 0 && fallback) {
    shapes.push({
      key: event.id,
      kind: "area",
      lat: fallback[0],
      lng: fallback[1],
      radiusM: 10_000,
      label: "",
    });
  }
  return shapes;
}

export function disasterTypeOf(event: AlertEvent): string {
  if (event.source === "missing") return "실종";
  if (event.source === "eqk") return "지진";
  if (event.source === "typhoon") return "태풍";
  if (event.source === "landslide") return "산사태";
  const typed = event.llm?.disasterType;
  if (typed && typed !== "기타") return typed;
  const text = event.rawText;
  if (/민방공|공습경보/.test(text)) return "민방공";
  if (/지진/.test(text)) return "지진";
  if (/산사태/.test(text)) return "산사태";
  if (/호우|폭우|침수|소나기|많은 비|많은비|강한 비|강우|비가 많이/.test(text)) return "호우";
  if (/태풍/.test(text)) return "태풍";
  if (/너울|이안류|풍랑/.test(text)) return "풍랑";
  if (/강풍/.test(text)) return "강풍";
  if (/건조주의보|건조경보/.test(text)) return "건조";
  if (/대설|폭설/.test(text)) return "대설";
  if (/한파/.test(text)) return "한파";
  if (/폭염|열대야|온열|무더위|무더운|더위|최고기온/.test(text)) return "폭염";
  if (/산불/.test(text)) return "산불";
  if (/구제역/.test(text)) return "구제역";
  if (/미세먼지|황사/.test(text)) return "미세먼지";
  if (/정전/.test(text)) return "정전";
  if (/물놀이/.test(text)) return "물놀이";
  if (/화재|폭발사고|가스폭발/.test(text)) return "화재";
  if (/교통|통제|고속도로|하상도로|잠수교|지하차도/.test(text)) return "교통";
  return typed || "기타";
}

export function disasterStyle(type: string): { color: string; emoji: string } {
  switch (type) {
    case "호우":
      return { color: "#2563eb", emoji: "💧" };
    case "폭염":
      return { color: "#f97316", emoji: "🔆" };
    case "태풍":
      return { color: "#7c3aed", emoji: "🌀" };
    case "강풍":
      return { color: "#64748b", emoji: "💨" };
    case "건조":
      return { color: "#b45309", emoji: "🌵" };
    case "풍랑":
      return { color: "#0e7490", emoji: "🌊" };
    case "대설":
      return { color: "#38bdf8", emoji: "❄️" };
    case "한파":
      return { color: "#67e8f9", emoji: "🧊" };
    case "미세먼지":
      return { color: "#78716c", emoji: "🌫️" };
    case "지진":
      return { color: "#9f1239", emoji: "〰️" };
    case "산불":
    case "화재":
      return { color: "#dc2626", emoji: "🔥" };
    case "구제역":
      return { color: "#9a3412", emoji: "🐄" };
    case "민방공":
      return { color: "#f43f5e", emoji: "🚨" };
    case "실종":
      return { color: "#f59e0b", emoji: "👤" };
    case "교통":
      return { color: "#ea580c", emoji: "🚗" };
    case "산사태":
      return { color: "#b45309", emoji: "⛰️" };
    case "정전":
      return { color: "#eab308", emoji: "⚡" };
    case "물놀이":
      return { color: "#0284c7", emoji: "🏊" };
    default:
      return { color: "#ef4444", emoji: "📍" };
  }
}

export function areaFill(event: AlertEvent): string {
  return disasterStyle(disasterTypeOf(event)).color;
}

export function areaLocations(event: AlertEvent): string[] {
  return collapseSameCityDistricts(dropCoarseParents(eventLocations(event))).slice(0, 40);
}
