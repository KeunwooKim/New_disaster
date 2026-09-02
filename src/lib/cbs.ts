export type CbsMessage = {
  id: string;
  occurredAt: string;
  rawText: string;
  regions: string[];
  raw: Record<string, unknown>;
};

const DSSP_URL = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00247";

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

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function ymdLocal(daysAgo = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseOccurredAt(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 14) {
    const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}+09:00`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (digits.length >= 8) {
    const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00+09:00`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return new Date().toISOString();
}

function collectRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root) return [];

  if (Array.isArray(root.body)) {
    return root.body.map((item) => asRecord(item)).filter(Boolean) as Record<string, unknown>[];
  }

  const disaster = root.DisasterMsg ?? root.DisasterMessage;
  if (Array.isArray(disaster)) {
    for (const part of disaster) {
      const rec = asRecord(part);
      if (rec?.row) {
        return asArray(rec.row).map((item) => asRecord(item)).filter(Boolean) as Record<string, unknown>[];
      }
    }
  }

  const body = asRecord(root.response)?.body ?? asRecord(root.body);
  const bodyRec = asRecord(body);
  const items = asRecord(bodyRec?.items)?.item ?? bodyRec?.items;
  if (items) {
    return asArray(items).map((item) => asRecord(item)).filter(Boolean) as Record<string, unknown>[];
  }

  if (Array.isArray(root.row)) {
    return root.row.map((item) => asRecord(item)).filter(Boolean) as Record<string, unknown>[];
  }
  return [];
}

function normalizeRow(row: Record<string, unknown>): CbsMessage | null {
  const msg = pickString(row, ["MSG_CN", "msg", "MSG", "msg_cn", "message", "contents"]);
  if (!msg) return null;
  const sn = pickString(row, ["SN", "md101_sn", "MD101_SN", "sn", "msg_sn", "id"]);
  const created = pickString(row, ["CRT_DT", "create_date", "crtDt", "CREAT_DT", "regDate", "REG_YMD"]);
  const location = pickString(row, [
    "RCPTN_RGN_NM",
    "location_name",
    "loc_name",
    "rcptnRgnNm",
    "region",
  ]);
  const regions = location
    ? location.split(/[,/]/).map((part) => part.trim()).filter(Boolean)
    : [];
  return {
    id: `cbs:${sn || Buffer.from(msg).toString("base64url").slice(0, 24)}`,
    occurredAt: parseOccurredAt(created),
    rawText: msg,
    regions,
    raw: row,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`CBS HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`CBS JSON 파싱 실패: ${text.slice(0, 200)}`);
  }
}

async function fetchDsspDay(serviceKey: string, crtDt: string, numOfRows: number): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    serviceKey,
    returnType: "json",
    pageNo: "1",
    numOfRows: String(numOfRows),
    crtDt,
  });
  const payload = await fetchJson(`${DSSP_URL}?${params.toString()}`);
  const root = asRecord(payload);
  const header = asRecord(root?.header);
  const code = String(header?.resultCode ?? "");
  if (code && code !== "00") {
    const detail = pickString(header ?? {}, ["resultMsg", "errorMsg"]) || "unknown";
    throw new Error(`DSSP ${code}: ${detail}`);
  }
  return collectRows(payload);
}

export async function fetchCbsMessages(serviceKey: string, rows = 100): Promise<CbsMessage[]> {
  const seen = new Set<string>();
  const messages: CbsMessage[] = [];
  const errors: string[] = [];

  for (const daysAgo of [0, 1]) {
    try {
      for (const row of await fetchDsspDay(serviceKey, ymdLocal(daysAgo), rows)) {
        const message = normalizeRow(row);
        if (!message || seen.has(message.id)) continue;
        seen.add(message.id);
        messages.push(message);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (messages.length === 0 && errors.length > 0) {
    throw new Error(errors.join(" | "));
  }
  return messages;
}
