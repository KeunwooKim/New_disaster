export type MissingPerson = {
  id: string;
  occurredAt: string;
  rawText: string;
  regions: string[];
  photoUrl: string | null;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function parseDate(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8) {
    const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T12:00:00+09:00`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function targetLabel(code: string): string {
  const map: Record<string, string> = {
    "010": "아동",
    "020": "가출인",
    "040": "시설보호무연고자",
    "060": "지적장애인",
    "061": "지적장애인(18세미만)",
    "062": "지적장애인(18세이상)",
    "070": "치매질환자",
    "080": "기타",
  };
  return map[code] ?? code;
}

function toPerson(row: Record<string, unknown>): MissingPerson | null {
  const id = pick(row, ["msspsnIdntfccd", "msspsnId", "esntlId", "occrde"]) || JSON.stringify(row).slice(0, 24);
  const name = pick(row, ["nm", "name"]);
  const sex = pick(row, ["sexdstnDscd", "sex"]);
  const age = pick(row, ["age", "ageNow"]);
  const address = pick(row, ["occrAdres", "occrPlace"]);
  const occrde = pick(row, ["occrde", "occrDate"]);
  const clothes = pick(row, ["alldressingDscd"]);
  const feature = pick(row, ["etcSpfeatr"]);
  const target = targetLabel(pick(row, ["writngTrgetDscd"]));
  const parts = [
    name ? `성명 ${name}` : null,
    target ? `대상 ${target}` : null,
    sex ? `성별 ${sex}` : null,
    age ? `당시나이 ${age}` : null,
    address ? `발생장소 ${address}` : null,
    occrde ? `발생일 ${occrde}` : null,
    clothes ? `착의 ${clothes}` : null,
    feature ? `특징 ${feature}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const photoId = pick(row, ["msspsnIdntfccd"]);
  const hasPhoto = pick(row, ["tknphotoFile"]).replace(/\s+/g, "").length > 80;
  return {
    id: `missing:${id}`,
    occurredAt: parseDate(occrde),
    rawText: parts.join(". ") + ".",
    regions: address ? [address] : [],
    photoUrl: photoId && hasPhoto ? `/api/missing-photo/${encodeURIComponent(photoId)}` : null,
    raw: row,
  };
}

async function postForm(url: string, body: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Safe182 HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Safe182 JSON 파싱 실패: ${text.slice(0, 200)}`);
  }
}

function extractList(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root) return [];
  const list = root.list ?? root.resultList;
  if (!Array.isArray(list)) return [];
  return list.map((item) => asRecord(item)).filter(Boolean) as Record<string, unknown>[];
}

export async function fetchMissingPersons(
  esntlId: string,
  authKey: string,
  rowSize = 30,
): Promise<MissingPerson[]> {
  const common = { esntlId, authKey, rowSize: String(rowSize), page: "1" };
  const payloads = await Promise.allSettled([
    postForm("https://www.safe182.go.kr/api/lcm/amberList.do", common),
    postForm("https://www.safe182.go.kr/api/lcm/findChildList.do", common),
  ]);

  const seen = new Set<string>();
  const people: MissingPerson[] = [];
  const errors: string[] = [];

  for (const result of payloads) {
    if (result.status === "rejected") {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      continue;
    }
    for (const row of extractList(result.value)) {
      const person = toPerson(row);
      if (!person || seen.has(person.id)) continue;
      seen.add(person.id);
      people.push(person);
    }
  }

  if (people.length === 0 && errors.length > 0) {
    throw new Error(errors.join(" | "));
  }
  return people;
}
