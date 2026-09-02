export type EventSource = "cbs" | "missing" | "kma_wrn" | "eqk" | "typhoon" | "landslide";

export const EVENT_SOURCE_LABEL: Record<EventSource, string> = {
  cbs: "재난문자",
  missing: "실종",
  kma_wrn: "기상특보",
  eqk: "지진",
  typhoon: "태풍",
  landslide: "산사태",
};

/** 화면에 쓰는 공식 자료 출처 */
export const EVENT_SOURCE_CREDIT: Record<EventSource, string> = {
  cbs: "행정안전부 긴급재난문자",
  missing: "경찰청 안전Dream",
  kma_wrn: "기상청 기상특보",
  eqk: "기상청 지진정보",
  typhoon: "기상청 태풍정보",
  landslide: "산림청 산사태 예측정보",
};

export const DATA_CREDIT_LINE =
  "자료 출처: 행정안전부 긴급재난문자 · 기상청 기상특보·지진·태풍 · 산림청 산사태 예측 · 경찰청 안전Dream";

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
