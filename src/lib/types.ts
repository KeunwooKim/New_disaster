export type EventSource = "cbs" | "missing" | "kma_wrn" | "eqk" | "typhoon" | "landslide";

export const EVENT_SOURCE_LABEL: Record<EventSource, string> = {
  cbs: "재난문자",
  missing: "실종",
  kma_wrn: "기상특보",
  eqk: "지진",
  typhoon: "태풍",
  landslide: "산사태",
};

export const EVENT_SOURCES = Object.keys(EVENT_SOURCE_LABEL) as EventSource[];
export type AnalysisStatus = "pending" | "llm" | "rules" | "ner" | "error";
export type Severity = "low" | "medium" | "high" | "critical";

export type LlmAnalysis = {
  disasterType: string;
  locations: string[];
  severity: Severity;
  summary: string;
  actions: string;
  appearance?: string;
  clothing?: string;
  lastSeen?: string;
};

export type AlertEvent = {
  id: string;
  source: EventSource;
  occurredAt: string;
  rawText: string;
  regions: string[];
  photoUrl: string | null;
  llm: LlmAnalysis | null;
  analysisStatus: AnalysisStatus;
  lat: number | null;
  lng: number | null;
  geocodeStatus: string;
};

export type IngestResult = {
  fetched: number;
  inserted: number;
  analyzed: number;
  geocoded: number;
  errors: string[];
};
