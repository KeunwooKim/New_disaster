import { fetchCbsMessages } from "./cbs";
import {
  countEvents,
  deleteEventsBySource,
  insertEvent,
  listCentroidGeocodes,
  listEvents,
  listPendingAnalysis,
  listPendingGeocode,
  updateAnalysis,
  updateCoords,
} from "./db";
import { resolveCoordinates, purgeImplausibleGeocodeCache, repairStoredCoordinates } from "./geocode";
import { mapKindForEvent, eventLocations } from "./map-shape";
import { isStreetAddress } from "./street";
import { fetchEarthquakes } from "./kma-eqk";
import { fetchTyphoons } from "./kma-typhoon";
import { fetchWeatherWarnings } from "./kma-wrn";
import { fetchLandslideForecasts } from "./landslide";
import { analyzeEvent } from "./llm";
import { fetchMissingPersons } from "./missing";
import { portalServiceKey, type PortalEvent } from "./portal";
import { parseCbsByRules } from "./rules";
import { seedIfEmpty } from "./seed";
import type { EventSource, IngestResult } from "./types";

function ingestPortal(
  source: EventSource,
  events: PortalEvent[],
  result: IngestResult,
  geocodeStatus: string,
  replace = false,
): void {
  if (replace) deleteEventsBySource(source);
  result.fetched += events.length;
  for (const event of events) {
    const analysis = parseCbsByRules(event.rawText, event.regions, source);
    if (event.regions.length > 0 && source !== "eqk") analysis.locations = event.regions;
    if (
      insertEvent({
        id: event.id,
        source,
        occurredAt: event.occurredAt,
        rawText: event.rawText,
        rawJson: event.raw,
        regions: event.regions,
        lat: event.lat,
        lng: event.lng,
        geocodeStatus: event.lat != null && event.lng != null ? "official" : geocodeStatus,
        analysis,
        analysisStatus: "rules",
      })
    ) {
      if (!replace) result.inserted += 1;
    }
  }
}

function reparseStoredEvents(): void {
  for (const source of ["cbs", "missing"] as const) {
    for (const event of listEvents(source, 5000)) {
      if (event.analysisStatus === "pending") continue;
      const parsed = parseCbsByRules(event.rawText, [], source);
      const prev = event.llm;
      const next = {
        ...parsed,
        appearance: prev?.appearance ?? parsed.appearance,
        clothing: prev?.clothing ?? parsed.clothing,
        lastSeen: source === "missing" ? parsed.locations[0] ?? prev?.lastSeen : undefined,
      };
      if (JSON.stringify(next) === JSON.stringify(prev) && event.analysisStatus === "rules") continue;
      updateAnalysis(event.id, next, "rules", next.locations);
    }
  }
}

export async function ingestAll(): Promise<IngestResult> {
  const result: IngestResult = {
    fetched: 0,
    inserted: 0,
    analyzed: 0,
    geocoded: 0,
    errors: [],
  };

  const cbsKey = process.env.DATA_GO_KR_KEY;
  if (cbsKey) {
    try {
      const messages = await fetchCbsMessages(cbsKey);
      result.fetched += messages.length;
      for (const message of messages) {
        if (
          insertEvent({
            id: message.id,
            source: "cbs",
            occurredAt: message.occurredAt,
            rawText: message.rawText,
            rawJson: message.raw,
            regions: message.regions,
          })
        ) {
          result.inserted += 1;
        }
      }
    } catch (error) {
      result.errors.push(`재난문자: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    result.errors.push("재난문자: DATA_GO_KR_KEY 없음");
  }

  const esntlId = process.env.SAFE182_ESNTL_ID;
  const authKey = process.env.SAFE182_AUTH_KEY;
  if (esntlId && authKey) {
    try {
      const people = await fetchMissingPersons(esntlId, authKey);
      result.fetched += people.length;
      for (const person of people) {
        if (
          insertEvent({
            id: person.id,
            source: "missing",
            occurredAt: person.occurredAt,
            rawText: person.rawText,
            rawJson: person.raw,
            regions: person.regions,
            photoUrl: person.photoUrl,
          })
        ) {
          result.inserted += 1;
        }
      }
    } catch (error) {
      result.errors.push(`실종: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    result.errors.push("실종: SAFE182 키 없음");
  }

  const portalKey = portalServiceKey();
  if (portalKey) {
    try {
      ingestPortal("kma_wrn", await fetchWeatherWarnings(portalKey), result, "area", true);
    } catch (error) {
      result.errors.push(`기상특보: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      ingestPortal("eqk", await fetchEarthquakes(portalKey), result, "official", true);
    } catch (error) {
      result.errors.push(`지진: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      ingestPortal("typhoon", await fetchTyphoons(portalKey), result, "official");
    } catch (error) {
      result.errors.push(`태풍: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      ingestPortal("landslide", await fetchLandslideForecasts(portalKey), result, "area");
    } catch (error) {
      result.errors.push(`산사태: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    result.errors.push("포털: DATA_GO_KR_PORTAL_KEY 없음");
  }

  if (countEvents() === 0) {
    seedIfEmpty();
  }

  reparseStoredEvents();
  purgeImplausibleGeocodeCache();
  repairStoredCoordinates();

  const pending = listPendingAnalysis(12);
  for (const event of pending) {
    try {
      const { analysis, status } = await analyzeEvent(event);
      const regions = analysis.locations.length > 0 ? analysis.locations : event.regions;
      updateAnalysis(event.id, analysis, status, regions);
      result.analyzed += 1;
    } catch (error) {
      result.errors.push(`분석 ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const geoPending = listPendingGeocode(8);
  const geoRetry = listCentroidGeocodes(80)
    .filter((event) => mapKindForEvent(event) === "point")
    .filter((event) => !geoPending.some((row) => row.id === event.id))
    .sort((a, b) => {
      const aStreet = eventLocations(a).some((name) => isStreetAddress(name)) ? 1 : 0;
      const bStreet = eventLocations(b).some((name) => isStreetAddress(name)) ? 1 : 0;
      return bStreet - aStreet;
    })
    .slice(0, 12);
  for (const event of [...geoPending, ...geoRetry]) {
    const coords = await resolveCoordinates(event);
    updateCoords(event.id, coords.lat, coords.lng, coords.status);
    if (coords.lat != null && coords.status === "nominatim") result.geocoded += 1;
    else if (coords.lat != null && event.lat == null) result.geocoded += 1;
  }

  return result;
}
