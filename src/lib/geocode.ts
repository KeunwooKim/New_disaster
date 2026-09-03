import { deleteGeocodeCache, getGeocodeCache, listEvents, listGeocodeCache, setGeocodeCache, updateCoords } from "./db";
import { eventLocations, mapKindForEvent } from "./map-shape";
import { isSidoCentroidCoord, lookupCentroid } from "./region-centroids";
import { extractStreetAddresses, isRoadName, isStreetAddress } from "./street";
import type { AlertEvent } from "./types";

const COARSE_ALIAS = new Set([
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "제주",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
]);

const FACILITY_RE = /([가-힣0-9]{1,12}(?:잠수교|하상도로|생태공원|나들목|육교|[가-힣]대교)|[가-힣0-9]{2,10}교)/g;
const NUMBERED_RE = /([가-힣]+(?:동|리|읍|면)\s*\d+(?:-\d+)?)/g;

let lastNominatimAt = 0;

function lastToken(name: string): string {
  return name.trim().split(/\s+/).pop() ?? name;
}

export function querySpecificity(query: string): number {
  const token = lastToken(query);
  if (/\d+번길|\d+[가나다라마바사아자차카타파하]길|번지|아파트|(?:대로|로|길)\s*\d/.test(query)) {
    return 6;
  }
  if (/잠수교|하상도로|생태공원|나들목|육교|대교|[가-힣0-9]{2,10}교$/.test(query) && !/학교$/.test(token)) return 5;
  if (isRoadName(query)) return 5;
  if (/[동리]$/.test(token) || /동\s*\d/.test(query)) return 4;
  if (/[읍면]$/.test(token)) return 3;
  if (/구$/.test(token) && !/(특별시|광역시|특별자치시)$/.test(token)) return 2;
  if (/[시군]$/.test(token) && !/(특별시|광역시|특별자치시)$/.test(token)) return 1;
  return 0;
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (!trimmed || COARSE_ALIAS.has(trimmed)) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function cityContext(locations: string[]): string | null {
  const ranked = [...locations].sort((a, b) => querySpecificity(b) - querySpecificity(a));
  return ranked.find((name) => querySpecificity(name) >= 1 && querySpecificity(name) <= 2) ?? null;
}

function withParent(place: string, locations: string[]): string {
  if (locations.some((name) => name !== place && name.includes(place) && name.length > place.length)) {
    return locations.find((name) => name !== place && name.includes(place) && name.length > place.length) ?? place;
  }
  const city = cityContext(locations);
  if (city && !place.includes(lastToken(city)) && (querySpecificity(place) >= 4 || isStreetAddress(place))) {
    return `${city} ${place}`;
  }
  return place;
}

function placesFromText(text: string): string[] {
  const found: string[] = [...extractStreetAddresses(text)];
  for (const re of [FACILITY_RE, NUMBERED_RE]) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const value = match[0]?.trim();
      if (value && value.length >= 2 && !/학교$/.test(value)) found.push(value);
    }
  }
  return found;
}

export function geocodeQueries(event: AlertEvent): string[] {
  const locations = eventLocations(event);
  const fromText = placesFromText(event.rawText).map((place) => withParent(place, locations));
  const merged = unique([...fromText, ...locations, event.llm?.lastSeen ?? ""]);
  const ranked = merged.sort((a, b) => querySpecificity(b) - querySpecificity(a) || b.length - a.length);
  return ranked.filter(
    (query) =>
      !ranked.some(
        (other) =>
          other !== query && other.includes(query) && querySpecificity(other) >= querySpecificity(query),
      ),
  );
}

function inKorea(lat: number, lng: number): boolean {
  return lat > 33 && lat < 39.7 && lng > 124.4 && lng < 132.2;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinLng * sinLng;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function maxKmForQuery(query: string): number {
  const token = lastToken(query);
  if (/(?:대로|로|길)\s*\d|번길|번지/.test(query) || /[동리]$/.test(token) || /동\s*\d/.test(query)) return 30;
  if (/[읍면]/.test(query)) return 50;
  if (/구/.test(query)) return 25;
  if (/군/.test(query)) return 90;
  if (/시/.test(query) && !/(특별시|광역시|특별자치시)$/.test(token)) return 45;
  return 250;
}

export function coordsFitQuery(lat: number, lng: number, query: string, context = ""): boolean {
  if (querySpecificity(query) >= 1 && isSidoCentroidCoord(lat, lng)) return false;
  const anchor = lookupCentroid(query, context);
  if (!anchor) return !isSidoCentroidCoord(lat, lng) || querySpecificity(query) < 1;
  return haversineKm([lat, lng], anchor) <= maxKmForQuery(query);
}

export function coordsFitQueries(lat: number, lng: number, queries: string[], context = ""): boolean {
  const ranked = [...queries].sort(
    (a, b) => querySpecificity(b) - querySpecificity(a) || b.length - a.length,
  );
  const anchored = ranked.filter((query) => lookupCentroid(query, context) != null);
  if (anchored.length === 0) {
    return !(ranked.some((query) => querySpecificity(query) >= 1) && isSidoCentroidCoord(lat, lng));
  }
  return coordsFitQuery(lat, lng, anchored[0], context);
}

export function finestCentroid(queries: string[], context = ""): [number, number] | null {
  const ranked = [...queries].sort(
    (a, b) => querySpecificity(b) - querySpecificity(a) || b.length - a.length,
  );
  const hasFine = ranked.some((query) => querySpecificity(query) >= 1);
  for (const query of ranked) {
    const hit = lookupCentroid(query, context);
    if (!hit) continue;
    if (hasFine && isSidoCentroidCoord(hit[0], hit[1])) continue;
    return hit;
  }
  return null;
}

function acceptResolved(lat: number, lng: number, query: string, context = ""): boolean {
  return inKorea(lat, lng) && coordsFitQuery(lat, lng, query, context);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function nominatim(query: string): Promise<[number, number] | null> {
  const wait = 1100 - (Date.now() - lastNominatimAt);
  if (wait > 0) await sleep(wait);
  lastNominatimAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("accept-language", "ko");
  const response = await fetch(url, {
    headers: {
      "User-Agent": "urban-alert/0.1 (local disaster map; kim@localhost)",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = (await response.json()) as Array<{ lat: string; lon: string }>;
  const first = data[0];
  if (!first) return null;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !acceptResolved(lat, lng, query)) return null;
  return [lat, lng];
}

function cachedCoords(query: string, queries: string[], context: string): [number, number] | null {
  const cached = getGeocodeCache(`nom:${query}`);
  if (!cached) return null;
  if (!acceptResolved(cached.lat, cached.lng, query, context)) return null;
  if (!coordsFitQueries(cached.lat, cached.lng, queries, context)) return null;
  return [cached.lat, cached.lng];
}

function shortenAdmin(query: string): string {
  return query
    .replace(/특별자치시/g, "")
    .replace(/광역시/g, "")
    .replace(/특별시/g, "")
    .replace(/특별자치도/g, "도")
    .replace(/\s+/g, " ")
    .trim();
}

function nominatimVariants(query: string): string[] {
  const compactRoad = query.replace(/((?:대로|로|길))\s+(\d)/g, "$1$2");
  const spacedBranch = query.replace(
    /((?:대로|로))(\d+(?:-\d+)?(?:번길|[가나다라마바사아자차카타파하]길))/g,
    "$1 $2",
  );
  // `삼안로 153번길` / `화곡로 10길` / `양녕로22가길` → 본도로 `삼안로`
  const branchParent = query
    .replace(/((?:대로|로))\s*\d+(?:-\d+)?(?:번길|[가나다라마바사아자차카타파하]?길)$/, "$1")
    .trim();
  // `풍덕주택길 76` → 길 이름은 유지하고 건물번호만 제거
  const dropBuilding = query.replace(/((?:대로|로|길))\s+\d+(?:-\d+)?$/, "$1").trim();
  return unique([
    query,
    compactRoad,
    spacedBranch,
    shortenAdmin(query),
    shortenAdmin(compactRoad),
    shortenAdmin(spacedBranch),
    branchParent,
    shortenAdmin(branchParent),
    dropBuilding,
    shortenAdmin(dropBuilding),
  ]).filter((item) => item.length >= 4);
}

async function nominatimAccepted(query: string, queries: string[], context: string): Promise<[number, number] | null> {
  for (const variant of nominatimVariants(query)) {
    const cached = cachedCoords(variant, queries, context);
    if (cached) return cached;
    try {
      const coords = await nominatim(variant);
      if (coords && coordsFitQueries(coords[0], coords[1], queries, context)) {
        setGeocodeCache(`nom:${variant}`, coords[0], coords[1]);
        setGeocodeCache(`nom:${query}`, coords[0], coords[1]);
        return coords;
      }
    } catch {
      // try next variant
    }
  }
  return null;
}

function kakaoKey(): string | null {
  const key = process.env.KAKAO_REST_KEY?.trim();
  return key || null;
}

function kakaoVariants(query: string): string[] {
  const compactRoad = query.replace(/((?:대로|로|길))\s+(\d)/g, "$1$2");
  return unique([query, compactRoad, shortenAdmin(query), shortenAdmin(compactRoad)]).filter(
    (item) => item.length >= 4,
  );
}

function kakaoCached(query: string, queries: string[], context: string): [number, number] | null {
  const cached = getGeocodeCache(`kakao:${query}`);
  if (!cached) return null;
  if (!acceptResolved(cached.lat, cached.lng, query, context)) return null;
  if (!coordsFitQueries(cached.lat, cached.lng, queries, context)) return null;
  return [cached.lat, cached.lng];
}

function kakaoPoint(doc: { x?: string; y?: string; road_address?: { x?: string; y?: string } | null }): [number, number] | null {
  const x = Number(doc.road_address?.x ?? doc.x);
  const y = Number(doc.road_address?.y ?? doc.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [y, x];
}

function kakaoTypeOk(query: string, addressType: string | undefined): boolean {
  if (querySpecificity(query) < 5) return true;
  return addressType !== "REGION";
}

async function kakaoFetch(path: string, query: string): Promise<Array<Record<string, unknown>>> {
  const key = kakaoKey();
  if (!key) return [];
  const url = new URL(`https://dapi.kakao.com/v2/local/search/${path}.json`);
  url.searchParams.set("query", query);
  url.searchParams.set("size", "5");
  const response = await fetch(url, {
    headers: { Authorization: `KakaoAK ${key}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { documents?: Array<Record<string, unknown>> };
  return data.documents ?? [];
}

async function kakaoAccepted(query: string, queries: string[], context: string): Promise<[number, number] | null> {
  if (!kakaoKey()) return null;
  for (const variant of kakaoVariants(query)) {
    const cached = kakaoCached(variant, queries, context);
    if (cached) return cached;
    try {
      for (const doc of await kakaoFetch("address", variant)) {
        if (!kakaoTypeOk(query, typeof doc.address_type === "string" ? doc.address_type : undefined)) continue;
        const coords = kakaoPoint(doc as { x?: string; y?: string; road_address?: { x?: string; y?: string } | null });
        if (!coords) continue;
        if (!acceptResolved(coords[0], coords[1], query, context)) continue;
        if (!coordsFitQueries(coords[0], coords[1], queries, context)) continue;
        setGeocodeCache(`kakao:${variant}`, coords[0], coords[1]);
        setGeocodeCache(`kakao:${query}`, coords[0], coords[1]);
        return coords;
      }
    } catch {
      // try keyword
    }
  }

  const cached = kakaoCached(query, queries, context);
  if (cached) return cached;
  try {
    for (const doc of await kakaoFetch("keyword", query)) {
      const coords = kakaoPoint(doc as { x?: string; y?: string });
      if (!coords) continue;
      if (!acceptResolved(coords[0], coords[1], query, context)) continue;
      if (!coordsFitQueries(coords[0], coords[1], queries, context)) continue;
      setGeocodeCache(`kakao:${query}`, coords[0], coords[1]);
      return coords;
    }
  } catch {
    return null;
  }
  return null;
}

function vworldKey(): string | null {
  const key = process.env.VWORLD_KEY?.trim();
  return key || null;
}

function vworldCached(query: string, queries: string[], context: string): [number, number] | null {
  const cached = getGeocodeCache(`vworld:${query}`);
  if (!cached) return null;
  if (!acceptResolved(cached.lat, cached.lng, query, context)) return null;
  if (!coordsFitQueries(cached.lat, cached.lng, queries, context)) return null;
  return [cached.lat, cached.lng];
}

async function vworldGetCoord(query: string, type: "road" | "parcel"): Promise<[number, number] | null> {
  const key = vworldKey();
  if (!key) return null;
  const url = new URL("https://api.vworld.kr/req/address");
  url.searchParams.set("service", "address");
  url.searchParams.set("request", "getcoord");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "epsg:4326");
  url.searchParams.set("address", query);
  url.searchParams.set("refine", "true");
  url.searchParams.set("simple", "false");
  url.searchParams.set("format", "json");
  url.searchParams.set("type", type);
  url.searchParams.set("key", key);
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    response?: { status?: string; result?: { point?: { x?: string; y?: string } } };
  };
  if (data.response?.status !== "OK") return null;
  const lng = Number(data.response.result?.point?.x);
  const lat = Number(data.response.result?.point?.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

async function vworldSearch(query: string): Promise<[number, number] | null> {
  const key = vworldKey();
  if (!key) return null;
  const url = new URL("https://api.vworld.kr/req/search");
  url.searchParams.set("service", "search");
  url.searchParams.set("request", "search");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("size", "5");
  url.searchParams.set("page", "1");
  url.searchParams.set("query", query);
  url.searchParams.set("type", "place");
  url.searchParams.set("format", "json");
  url.searchParams.set("key", key);
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    response?: {
      status?: string;
      result?: { items?: Array<{ point?: { x?: string; y?: string } }> };
    };
  };
  const point = data.response?.result?.items?.[0]?.point;
  const lng = Number(point?.x);
  const lat = Number(point?.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

async function vworldAccepted(query: string, queries: string[], context: string): Promise<[number, number] | null> {
  if (!vworldKey()) return null;
  for (const variant of kakaoVariants(query)) {
    const cached = vworldCached(variant, queries, context);
    if (cached) return cached;
    try {
      for (const type of ["road", "parcel"] as const) {
        const coords = await vworldGetCoord(variant, type);
        if (!coords) continue;
        if (!acceptResolved(coords[0], coords[1], query, context)) continue;
        if (!coordsFitQueries(coords[0], coords[1], queries, context)) continue;
        setGeocodeCache(`vworld:${variant}`, coords[0], coords[1]);
        setGeocodeCache(`vworld:${query}`, coords[0], coords[1]);
        return coords;
      }
    } catch {
      // try next variant
    }
  }
  try {
    const coords = await vworldSearch(query);
    if (
      coords &&
      acceptResolved(coords[0], coords[1], query, context) &&
      coordsFitQueries(coords[0], coords[1], queries, context)
    ) {
      setGeocodeCache(`vworld:${query}`, coords[0], coords[1]);
      return coords;
    }
  } catch {
    return null;
  }
  return null;
}

async function geocodePrecise(
  query: string,
  queries: string[],
  context: string,
): Promise<{ lat: number; lng: number; status: string } | null> {
  const nominatim = await nominatimAccepted(query, queries, context);
  if (nominatim) return { lat: nominatim[0], lng: nominatim[1], status: "nominatim" };
  const vworld = await vworldAccepted(query, queries, context);
  if (vworld) return { lat: vworld[0], lng: vworld[1], status: "vworld" };
  const kakao = await kakaoAccepted(query, queries, context);
  if (kakao) return { lat: kakao[0], lng: kakao[1], status: "kakao" };
  return null;
}

export async function resolveCoordinates(event: AlertEvent): Promise<{
  lat: number | null;
  lng: number | null;
  status: string;
}> {
  const queries = geocodeQueries(event);
  const context = event.rawText;
  const precise = queries.filter((query) => querySpecificity(query) >= 4);
  const coarse = queries.filter((query) => querySpecificity(query) < 4);
  const wantPrecise = mapKindForEvent(event) === "point" || precise.length > 0;
  const centroid = finestCentroid(queries, context);

  if (wantPrecise) {
    for (const query of precise) {
      const coords = await geocodePrecise(query, queries, context);
      if (coords) return coords;
    }
  }

  if (
    event.lat != null &&
    event.lng != null &&
    (event.geocodeStatus === "nominatim" ||
      event.geocodeStatus === "kakao" ||
      event.geocodeStatus === "vworld" ||
      event.geocodeStatus === "official") &&
    coordsFitQueries(event.lat, event.lng, queries, context)
  ) {
    return { lat: event.lat, lng: event.lng, status: event.geocodeStatus };
  }

  if (centroid) return { lat: centroid[0], lng: centroid[1], status: "centroid" };

  if (event.lat != null && event.lng != null && coordsFitQueries(event.lat, event.lng, queries, context)) {
    return { lat: event.lat, lng: event.lng, status: event.geocodeStatus || "centroid" };
  }

  if (!wantPrecise) {
    return { lat: null, lng: null, status: "unresolved" };
  }

  for (const query of coarse) {
    const coords = await geocodePrecise(query, queries, context);
    if (coords) return coords;
  }

  return { lat: null, lng: null, status: "unresolved" };
}

export function purgeImplausibleGeocodeCache(): number {
  let removed = 0;
  for (const row of listGeocodeCache()) {
    const query = row.query.replace(/^nom:/, "");
    if (acceptResolved(row.lat, row.lng, query)) continue;
    deleteGeocodeCache(row.query);
    removed += 1;
  }
  return removed;
}

export function listRefinableCentroidPoints(limit: number): AlertEvent[] {
  return listEvents(undefined, 5000)
    .filter((event) => event.geocodeStatus === "centroid" || event.geocodeStatus === "cache")
    .filter((event) => event.lat != null)
    .filter((event) => mapKindForEvent(event) === "point")
    .filter((event) => geocodeQueries(event).some((query) => querySpecificity(query) >= 4))
    .sort((a, b) => {
      const specOf = (event: AlertEvent) =>
        Math.max(0, ...geocodeQueries(event).map((query) => querySpecificity(query)));
      return specOf(b) - specOf(a);
    })
    .slice(0, limit);
}

export function repairStoredCoordinates(): number {
  let updated = 0;
  for (const event of listEvents(undefined, 5000)) {
    if (event.geocodeStatus === "official" || event.geocodeStatus === "area") continue;
    const queries = geocodeQueries(event);
    const centroid = finestCentroid(queries, event.rawText);
    if (!centroid) continue;
    const fits =
      event.lat != null &&
      event.lng != null &&
      coordsFitQueries(event.lat, event.lng, queries, event.rawText);
    if (fits) continue;
    updateCoords(event.id, centroid[0], centroid[1], "centroid");
    updated += 1;
  }
  return updated;
}
