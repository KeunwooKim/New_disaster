import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AlertEvent, AnalysisStatus, EventSource, LlmAnalysis } from "./types";

const DB_PATH = path.join(process.cwd(), "data", "urban-alert.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      raw_json TEXT,
      regions TEXT NOT NULL DEFAULT '[]',
      photo_url TEXT,
      llm_json TEXT,
      analysis_status TEXT NOT NULL DEFAULT 'pending',
      lat REAL,
      lng REAL,
      geocode_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
    CREATE TABLE IF NOT EXISTS geocode_cache (
      query TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

type EventRow = {
  id: string;
  source: EventSource;
  occurred_at: string;
  raw_text: string;
  raw_json: string | null;
  regions: string;
  photo_url: string | null;
  llm_json: string | null;
  analysis_status: AnalysisStatus;
  lat: number | null;
  lng: number | null;
  geocode_status: string;
};

function rowToEvent(row: EventRow): AlertEvent {
  return {
    id: row.id,
    source: row.source,
    occurredAt: row.occurred_at,
    rawText: row.raw_text,
    regions: JSON.parse(row.regions) as string[],
    photoUrl: row.photo_url,
    llm: row.llm_json ? (JSON.parse(row.llm_json) as LlmAnalysis) : null,
    analysisStatus: row.analysis_status,
    lat: row.lat,
    lng: row.lng,
    geocodeStatus: row.geocode_status,
  };
}

export function listEvents(source?: EventSource, limit = 200): AlertEvent[] {
  const database = getDb();
  const rows = source
    ? database
        .prepare(
          `SELECT * FROM events WHERE source = ? ORDER BY occurred_at DESC LIMIT ?`,
        )
        .all(source, limit)
    : database.prepare(`SELECT * FROM events ORDER BY occurred_at DESC LIMIT ?`).all(limit);
  return (rows as EventRow[]).map(rowToEvent);
}

export function deleteEventsBySource(source: EventSource): number {
  return getDb().prepare(`DELETE FROM events WHERE source = ?`).run(source).changes;
}

export function countEvents(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number };
  return row.n;
}

export function eventExists(id: string): boolean {
  const row = getDb().prepare(`SELECT 1 AS n FROM events WHERE id = ?`).get(id) as
    | { n: number }
    | undefined;
  return Boolean(row);
}

export function insertEvent(input: {
  id: string;
  source: EventSource;
  occurredAt: string;
  rawText: string;
  rawJson?: unknown;
  regions: string[];
  photoUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  geocodeStatus?: string;
  analysis?: LlmAnalysis;
  analysisStatus?: AnalysisStatus;
}): boolean {
  const now = new Date().toISOString();
  const analysisStatus = input.analysisStatus ?? (input.analysis ? "rules" : "pending");
  const geocodeStatus =
    input.geocodeStatus ?? (input.lat != null && input.lng != null ? "official" : "pending");
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO events
        (id, source, occurred_at, raw_text, raw_json, regions, photo_url, llm_json, analysis_status, lat, lng, geocode_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.source,
      input.occurredAt,
      input.rawText,
      input.rawJson ? JSON.stringify(input.rawJson) : null,
      JSON.stringify(input.regions),
      input.photoUrl ?? null,
      input.analysis ? JSON.stringify(input.analysis) : null,
      analysisStatus,
      input.lat ?? null,
      input.lng ?? null,
      geocodeStatus,
      now,
      now,
    );
  return result.changes > 0;
}

export function listPendingAnalysis(limit = 8): AlertEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM events WHERE analysis_status = 'pending' ORDER BY occurred_at DESC LIMIT ?`,
    )
    .all(limit) as EventRow[];
  return rows.map(rowToEvent);
}

export function listPendingGeocode(limit = 20): AlertEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM events WHERE geocode_status = 'pending' AND lat IS NULL ORDER BY occurred_at DESC LIMIT ?`,
    )
    .all(limit) as EventRow[];
  return rows.map(rowToEvent);
}

export function listCentroidGeocodes(limit = 40): AlertEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM events WHERE geocode_status IN ('centroid', 'cache') AND lat IS NOT NULL ORDER BY occurred_at DESC LIMIT ?`,
    )
    .all(limit) as EventRow[];
  return rows.map(rowToEvent);
}

export function updateAnalysis(
  id: string,
  llm: LlmAnalysis,
  status: AnalysisStatus,
  regions?: string[],
): void {
  const now = new Date().toISOString();
  if (regions) {
    getDb()
      .prepare(
        `UPDATE events SET llm_json = ?, analysis_status = ?, regions = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(llm), status, JSON.stringify(regions), now, id);
    return;
  }
  getDb()
    .prepare(`UPDATE events SET llm_json = ?, analysis_status = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(llm), status, now, id);
}

export function updateCoords(
  id: string,
  lat: number | null,
  lng: number | null,
  status: string,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE events SET lat = ?, lng = ?, geocode_status = ?, updated_at = ? WHERE id = ?`)
    .run(lat, lng, status, now, id);
}

export function getGeocodeCache(query: string): { lat: number; lng: number } | null {
  const row = getDb()
    .prepare(`SELECT lat, lng FROM geocode_cache WHERE query = ?`)
    .get(query) as { lat: number; lng: number } | undefined;
  return row ?? null;
}

export function setGeocodeCache(query: string, lat: number, lng: number): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO geocode_cache (query, lat, lng, updated_at) VALUES (?, ?, ?, ?)`,
    )
    .run(query, lat, lng, new Date().toISOString());
}
