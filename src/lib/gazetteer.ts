import fs from "node:fs";
import path from "node:path";

export type GazetteerHit = {
  text: string;
  label: string;
  type: "sido" | "sgg" | "emd" | "ri" | "facility";
  start: number;
  end: number;
  sido?: string;
  sgg?: string;
};

type SidoRow = { name: string; aliases?: string[] };
type SggRow = { name: string; sido: string; parentSi?: string };
type EmdRow = { name: string; sgg: string; sido: string; parentSi?: string | null };
type RiRow = { name: string; emd: string; sgg: string; sido: string };

type GazetteerFile = {
  sido: SidoRow[];
  sgg: SggRow[];
  emd: EmdRow[];
  ri: RiRow[];
};

type SggPick = { name: string; sido?: string; parentSi?: string };

const GWANGJU_GU = new Set(["동구", "서구", "남구", "북구", "광산구"]);
const GENERIC_GU = new Set(["중구", "동구", "서구", "남구", "북구", "강서구"]);
const AMBIGUOUS_SGG = new Set([...GENERIC_GU, "고성군"]);
const FACILITY_SKIP = /학교|불교|종교|비교|선교|등교|하교|폐교|개교|교과|교통/;
const FACILITY_RE = /([가-힣0-9]{0,12}(?:잠수교|하상도로)|[가-힣]{2,8}교)/g;
const SENDER_RE = /\[([^\[\]\n]{1,40})\]\s*$/;

let cache: {
  file: GazetteerFile;
  sidoNeed: Array<{ name: string; canon: string }>;
  sidoNames: Map<string, string[]>;
  sggByName: Map<string, SggRow[]>;
  emdByName: Map<string, EmdRow[]>;
  riByName: Map<string, RiRow[]>;
} | null = null;

function load(): NonNullable<typeof cache> {
  if (cache) return cache;
  const filePath = path.join(process.cwd(), "data", "gazetteer", "admin.json");
  const file = JSON.parse(fs.readFileSync(filePath, "utf8")) as GazetteerFile;
  const sggByName = new Map<string, SggRow[]>();
  for (const row of file.sgg) {
    const list = sggByName.get(row.name) ?? [];
    list.push(row);
    sggByName.set(row.name, list);
  }
  const emdByName = new Map<string, EmdRow[]>();
  for (const row of file.emd) {
    const list = emdByName.get(row.name) ?? [];
    list.push(row);
    emdByName.set(row.name, list);
  }
  const riByName = new Map<string, RiRow[]>();
  for (const row of file.ri) {
    const list = riByName.get(row.name) ?? [];
    list.push(row);
    riByName.set(row.name, list);
  }
  const sidoNeed: Array<{ name: string; canon: string }> = [];
  const sidoNames = new Map<string, string[]>();
  for (const row of file.sido) {
    sidoNeed.push({ name: row.name, canon: row.name });
    for (const alias of row.aliases ?? []) sidoNeed.push({ name: alias, canon: row.name });
    sidoNames.set(row.name, [row.name, ...(row.aliases ?? [])]);
  }
  sidoNeed.push({ name: "전남광주", canon: "전남광주통합특별시" });
  const merged = sidoNames.get("전남광주통합특별시");
  if (merged && !merged.includes("전남광주")) merged.push("전남광주");
  sidoNeed.sort((a, b) => b.name.length - a.name.length);
  cache = { file, sidoNeed, sidoNames, sggByName, emdByName, riByName };
  return cache;
}

function indexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    out.push(at);
    from = at + needle.length;
  }
  return out;
}

function displaySido(sido: string | undefined, sgg?: string, matched?: string): string | undefined {
  if (!sido) return undefined;
  if (sido !== "전남광주통합특별시") return sido;
  const gu = sgg && GWANGJU_GU.has(sgg) ? sgg : undefined;
  if (gu || matched === "광주광역시") return "광주광역시";
  return "전라남도";
}

function sidoInContext(
  db: NonNullable<typeof cache>,
  row: { name?: string; sido?: string; parentSi?: string | null },
  context: string,
): boolean {
  if (row.parentSi && row.parentSi.length >= 2 && context.includes(row.parentSi)) return true;
  if (!row.sido) return false;
  if (row.name === "고성군") {
    if (row.sido.startsWith("강원") && /동해안|설악|속초/.test(context)) return true;
    if (row.sido === "경상남도" && /통영|사천|거제|남해안/.test(context)) return true;
  }
  return (db.sidoNames.get(row.sido) ?? [row.sido]).some((name) => name.length >= 2 && context.includes(name));
}

function preferCompactSgg(rows: SggRow[]): SggRow {
  const compact = rows.filter((row) => row.parentSi && row.name.startsWith(row.parentSi) && row.name !== row.parentSi);
  return compact[0] ?? rows[0];
}

function pickSgg(db: NonNullable<typeof cache>, rows: SggRow[], context: string): SggPick | null {
  if (rows.length === 1) {
    const row = rows[0];
    if (AMBIGUOUS_SGG.has(row.name) && !sidoInContext(db, row, context)) return null;
    return row;
  }
  const scoped = rows.filter((row) => sidoInContext(db, row, context));
  if (scoped.length === 1) return scoped[0];
  if (scoped.length > 1) return preferCompactSgg(scoped);
  return null;
}

function pickEmd(db: NonNullable<typeof cache>, rows: EmdRow[], context: string): EmdRow | null {
  const name = rows[0]?.name ?? "";
  const short = name.length <= 2;
  if (short) {
    const scoped = rows.filter((row) => Boolean(row.sgg && context.includes(row.sgg)));
    return scoped[0] ?? null;
  }
  if (rows.length === 1) return rows[0];
  const scoped = rows.filter((row) => sidoInContext(db, row, context) || Boolean(row.sgg && context.includes(row.sgg)));
  return scoped[0] ?? null;
}

function pickRi(rows: RiRow[], context: string): RiRow | null {
  const scoped = rows.filter((row) => context.includes(row.emd) && (context.includes(row.sgg) || context.includes(row.sido)));
  if (scoped[0]) return scoped[0];
  if (rows.length === 1 && rows[0].emd && context.includes(rows[0].emd)) return rows[0];
  const byEmd = rows.filter((row) => context.includes(row.emd));
  return byEmd.length === 1 ? byEmd[0] : null;
}

function fullLabel(
  type: GazetteerHit["type"],
  row: { name: string; sido?: string; sgg?: string; emd?: string; parentSi?: string | null },
  matchedSido?: string,
): string {
  const sido = displaySido(row.sido, row.sgg ?? (type === "sgg" ? row.name : undefined), matchedSido);
  if (type === "sido") return sido || row.name;
  if (type === "sgg") {
    const name = row.name;
    return [sido, row.parentSi && !name.startsWith(row.parentSi) ? row.parentSi : undefined, name]
      .filter(Boolean)
      .filter((item, i, arr) => arr.indexOf(item) === i)
      .join(" ");
  }
  if (type === "emd") {
    const sgg = row.sgg;
    const parentSi = row.parentSi && sgg && !sgg.startsWith(row.parentSi) ? row.parentSi : undefined;
    return [sido, parentSi, sgg, row.name].filter(Boolean).filter((item, i, arr) => arr.indexOf(item) === i).join(" ");
  }
  if (type === "ri") return [sido, row.sgg, row.emd, row.name].filter(Boolean).join(" ");
  return row.name;
}

function pruneContainedHits(hits: GazetteerHit[]): GazetteerHit[] {
  return hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other !== hit &&
          other.start <= hit.start &&
          other.end >= hit.end &&
          other.end - other.start > hit.end - hit.start,
      ),
  );
}

export function extractGazetteerHits(text: string, hint = ""): GazetteerHit[] {
  const db = load();
  const sender = text.match(SENDER_RE)?.[1]?.trim() ?? "";
  const context = `${text}\n${hint}\n${sender}`;
  const hits: GazetteerHit[] = [];

  const add = (hit: GazetteerHit) => {
    if (hits.some((row) => row.start === hit.start && row.end === hit.end)) return;
    hits.push(hit);
  };

  for (const sido of db.sidoNeed) {
    for (const start of indexesOf(text, sido.name)) {
      const after = text[start + sido.name.length] ?? "";
      if (
        (sido.name === "광주" || sido.name === "광주광역시") &&
        ((start >= 2 && text.slice(start - 2, start) === "전남") || after === "시")
      ) {
        continue;
      }
      const label = displaySido(sido.canon, undefined, sido.name) ?? sido.canon;
      add({
        text: sido.name,
        label,
        type: "sido",
        start,
        end: start + sido.name.length,
        sido: label,
      });
    }
  }

  for (const [name, rows] of db.sggByName) {
    for (const start of indexesOf(text, name)) {
      const row = pickSgg(db, rows, context);
      if (!row) continue;
      const sido = displaySido(row.sido, row.name);
      add({
        text: name,
        label: fullLabel("sgg", row),
        type: "sgg",
        start,
        end: start + name.length,
        sido,
        sgg: row.name,
      });
    }
  }

  for (const [name, rows] of db.emdByName) {
    if (name.length < 2) continue;
    for (const start of indexesOf(text, name)) {
      if (name.length <= 2) {
        const after = text[start + name.length] ?? "";
        if (/[가-힣]/.test(after)) continue;
      }
      const row = pickEmd(db, rows, context);
      if (!row) continue;
      add({
        text: name,
        label: fullLabel("emd", row),
        type: "emd",
        start,
        end: start + name.length,
        sido: displaySido(row.sido, row.sgg),
        sgg: row.sgg,
      });
    }
  }

  for (const [name, rows] of db.riByName) {
    for (const start of indexesOf(text, name)) {
      const row = pickRi(rows, context);
      if (!row) continue;
      add({
        text: name,
        label: fullLabel("ri", row),
        type: "ri",
        start,
        end: start + name.length,
        sido: displaySido(row.sido, row.sgg),
        sgg: row.sgg,
      });
    }
  }

  for (const match of text.matchAll(FACILITY_RE)) {
    const value = match[0];
    if (value.length < 2 || FACILITY_SKIP.test(value)) continue;
    const start = match.index ?? 0;
    const after = text[start + value.length] ?? "";
    if (/교$/.test(value) && /[가-힣]/.test(after)) continue;
    add({
      text: value,
      label: value,
      type: "facility",
      start,
      end: start + value.length,
    });
  }

  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  return pruneContainedHits(hits);
}

function canonAdminLabel(label: string): string {
  return label.replace(/전남광주통합특별시/g, "전라남도").replace(/\s+/g, " ").trim();
}

function gazetteerSidoForHint(hint: string): string | null {
  const db = load();
  const trimmed = hint.trim();
  if (!trimmed) return null;
  for (const row of db.file.sido) {
    if (row.name === trimmed || (row.aliases ?? []).includes(trimmed)) return row.name;
  }
  return null;
}

export function resolveSggInSido(sidoHint: string, place: string): string[] {
  const gazSido = gazetteerSidoForHint(sidoHint);
  if (!gazSido) return [];
  const rows = load().file.sgg.filter((row) => row.sido === gazSido);
  const has = (name: string) => rows.some((row) => row.name === name);
  const base = /(시|군|구)$/.test(place) ? (has(place) ? [place] : []) : [`${place}시`, `${place}군`, `${place}구`].filter(has);
  const out: string[] = [];
  for (const name of base) {
    const kids = rows.filter((row) => row.parentSi === name);
    if (kids.length === 0) {
      out.push(name);
      continue;
    }
    const compact = kids.filter((row) => row.name.startsWith(name) && row.name !== name);
    out.push(...(compact.length > 0 ? compact : kids).map((row) => row.name));
  }
  return [...new Set(out)];
}

export function gazetteerLocations(text: string, extra: string[] = []): string[] {
  const hits = extractGazetteerHits(text, extra.join(" "));
  const labels: string[] = [];
  for (const item of extra) {
    const glued = item.replace(/,\s*(?=[가-힣0-9]{2,25}(?:대로|로|길))/g, " ");
    for (const part of glued.split(/[,/·]/)) {
      const trimmed = canonAdminLabel(part);
      if (trimmed && !labels.includes(trimmed)) labels.push(trimmed);
    }
  }
  for (const hit of hits) {
    if (hit.type === "sido" && hits.some((other) => other.type !== "sido" && other.sido === hit.sido)) {
      continue;
    }
    if (!labels.includes(hit.label)) labels.push(hit.label);
  }
  return labels;
}
