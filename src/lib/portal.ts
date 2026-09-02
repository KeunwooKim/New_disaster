export type PortalEvent = {
  id: string;
  occurredAt: string;
  rawText: string;
  regions: string[];
  raw: Record<string, unknown>;
  lat?: number | null;
  lng?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export function portalServiceKey(): string | undefined {
  const raw = process.env.DATA_GO_KR_PORTAL_KEY?.trim();
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

export function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function ymdSeoul(daysAgo = 0): string {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000 - daysAgo * 86_400_000);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

export function parseKstDigits(raw: string | number): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length >= 14) {
    const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}+09:00`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (digits.length >= 12) {
    const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:00+09:00`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (digits.length >= 8) {
    const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00+09:00`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

export function portalItems(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  const body = asRecord(asRecord(root?.response)?.body) ?? asRecord(root?.body);
  const items = asRecord(body?.items)?.item ?? body?.items;
  if (items) return asArray(items).map((item) => asRecord(item)).filter(Boolean) as Record<string, unknown>[];
  return [];
}

export function portalResult(payload: unknown): { code: string; msg: string } {
  const root = asRecord(payload);
  const header = asRecord(asRecord(root?.response)?.header) ?? asRecord(root?.header) ?? {};
  return {
    code: pickString(header, ["resultCode", "resultcode"]),
    msg: pickString(header, ["resultMsg", "resultmsg"]),
  };
}

export async function fetchPortalJson(
  endpoint: string,
  serviceKey: string,
  params: Record<string, string>,
): Promise<unknown> {
  const search = new URLSearchParams({ serviceKey, dataType: "JSON", ...params });
  const url = `${endpoint}?${search.toString()}`;
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`JSON 파싱 실패: ${text.slice(0, 180)}`);
  }
}
