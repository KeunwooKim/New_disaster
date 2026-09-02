import { getGeocodeCache, setGeocodeCache } from "./db";
import { eventLocations, mapKindForEvent } from "./map-shape";
import { lookupCentroid } from "./region-centroids";
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

const STREET_RE = /([가-힣0-9]+(?:대로|로|길)\s*\d*(?:-\d+)?)/g;
const FACILITY_RE = /([가-힣0-9]{1,12}(?:잠수교|하상도로|[가-힣]대교)|[가-힣]{2,8}교)/g;
const NUMBERED_RE = /([가-힣]+(?:동|리|읍|면)\s*\d+(?:-\d+)?)/g;

let lastNominatimAt = 0;

function lastToken(name: string): string {
  return name.trim().split(/\s+/).pop() ?? name;
}

export function querySpecificity(query: string): number {
  const token = lastToken(query);
  if (/\d+번길|번지|아파트|대로|로\d+|(?:로|길)\s*\d/.test(query)) return 6;
  if (/잠수교|하상도로|대교|[가-힣]{2,8}교$/.test(query) && !/학교$/.test(token)) return 5;
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
  if (city && !place.includes(lastToken(city)) && querySpecificity(place) >= 4) {
    return `${city} ${place}`;
  }
  return place;
}

function placesFromText(text: string): string[] {
  const found: string[] = [];
  for (const re of [STREET_RE, FACILITY_RE, NUMBERED_RE]) {
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
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(lat, lng)) return null;
  return [lat, lng];
}

export async function resolveCoordinates(event: AlertEvent): Promise<{
  lat: number | null;
  lng: number | null;
  status: string;
}> {
  const queries = geocodeQueries(event);
  const precise = queries.filter((query) => querySpecificity(query) >= 4);
  const coarse = queries.filter((query) => querySpecificity(query) < 4);
  const wantPrecise = mapKindForEvent(event) === "point" || precise.length > 0;

  if (wantPrecise) {
    for (const query of precise) {
      const cached = getGeocodeCache(`nom:${query}`);
      if (cached) return { lat: cached.lat, lng: cached.lng, status: "nominatim" };
      try {
        const coords = await nominatim(query);
        if (coords) {
          setGeocodeCache(`nom:${query}`, coords[0], coords[1]);
          return { lat: coords[0], lng: coords[1], status: "nominatim" };
        }
      } catch {
        // try next query
      }
    }
  }

  for (const query of coarse) {
    const centroid = lookupCentroid(query);
    if (centroid) return { lat: centroid[0], lng: centroid[1], status: "centroid" };
  }

  if (event.lat != null && event.lng != null) {
    return { lat: event.lat, lng: event.lng, status: event.geocodeStatus || "centroid" };
  }

  if (!wantPrecise) {
    return { lat: null, lng: null, status: "unresolved" };
  }

  for (const query of coarse) {
    const cached = getGeocodeCache(`nom:${query}`);
    if (cached) return { lat: cached.lat, lng: cached.lng, status: "nominatim" };
    try {
      const coords = await nominatim(query);
      if (coords) {
        setGeocodeCache(`nom:${query}`, coords[0], coords[1]);
        return { lat: coords[0], lng: coords[1], status: "nominatim" };
      }
    } catch {
      // try next query
    }
  }

  return { lat: null, lng: null, status: "unresolved" };
}
