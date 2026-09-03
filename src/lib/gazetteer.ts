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
const SENDER_RE = /\[([^\[\]\n]{2,40})\]/g;
const SENDER_OFFICE = /(재난안전대책본부|소방서|경찰청|경찰서)$/;
const PLACE_TAIL = /^(?:[은는이가을를의도만과와]|에(?:서)?|으로|로|까지|부터|요|지역|일원|일대|인근|부근|사무소|주민)/;
const FACILITY_RE =
  /([가-힣0-9]{0,12}(?:잠수교|하상도로|생태공원|나들목|육교|고속도로)|[가-힣0-9]{2,10}(?:교|역))/g;
const FACILITY_SKIP = /학교|불교|종교|비교|선교|등교|하교|폐교|개교|교과|교통|지역|구역|방역|구제역|검역|영역/;
const VERB_MYEON_TAIL = /(하면|리면|되면|오면|가면|으면|시면|르면|지면)$/;
const KNOWN_MYEON = new Set(["상하면", "임하면", "구지면", "인지면", "토지면", "다시면", "송라면", "함라면"]);
const CITY_TOKEN_RE = /([가-힣]+(?:광역시|특별자치시|특별시)|[가-힣]+시|[가-힣]+군)/g;

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
    if (!plausibleRi(row)) continue;
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

function isolatedHangul(text: string, start: number, length: number): boolean {
  const before = text[start - 1] ?? "";
  const after = text[start + length] ?? "";
  const token = text.slice(start, start + length);
  const rest = text.slice(start + length);
  if (/[가-힣]/.test(before) && !/[시군구읍면동]/.test(before)) return false;
  if (!/[가-힣]/.test(after)) return true;
  if (after === "청") return true;
  if (PLACE_TAIL.test(rest)) return true;
  return /[시군구읍면동]$/.test(token) && /^(?:[가-힣0-9]{1,12}(?:시|군|구|읍|면|동|리))/.test(rest);
}

function sidoInContext(
  db: NonNullable<typeof cache>,
  row: { name?: string; sido?: string; parentSi?: string | null },
  context: string,
): boolean {
  if (row.parentSi && row.parentSi.length >= 2 && context.includes(row.parentSi)) return true;
  if (!row.sido) return false;
  if (row.name === "고성군") {
    if (row.sido.startsWith("강원") && /동해안|설악|속초|너울/.test(context)) return true;
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
  const scoped = rows.filter(
    (row) => sidoInContext(db, row, context) || Boolean(row.sgg && context.includes(row.sgg)),
  );
  if (short) {
    const bySgg = scoped.filter((row) => Boolean(row.sgg && context.includes(row.sgg)));
    return bySgg[0] ?? null;
  }
  if (scoped.length === 1) return scoped[0];
  if (scoped.length > 1) {
    const bySgg = scoped.filter((row) => Boolean(row.sgg && context.includes(row.sgg)));
    return bySgg[0] ?? scoped[0];
  }
  if (rows.length === 1) {
    const row = rows[0];
    if (row.sgg && context.includes(row.sgg)) return row;
    const rest = context.split(name).join("");
    if (!/[가-힣]+(?:시|군|구)/.test(rest)) return row;
  }
  return null;
}

function plausibleRi(row: RiRow): boolean {
  if (!/[시군구]$/.test(row.sgg)) return false;
  if (!/^[가-힣0-9]{1,12}(?:읍|면|동)$/.test(row.emd)) return false;
  if (/(으면|시면)$/.test(row.emd) || row.emd === "방면" || row.emd === "따르면" || row.emd === "떠내려가면") {
    return false;
  }
  if (/^(우리|무리)$/.test(row.name) || /거리$/.test(row.name)) return false;
  return true;
}

function pickRi(rows: RiRow[], context: string): RiRow | null {
  const plausible = rows.filter(plausibleRi);
  const scoped = plausible.filter((row) => {
    if (!context.includes(row.emd)) return false;
    if (context.includes(row.sgg)) return true;
    return row.sido.length >= 2 && context.includes(row.sido);
  });
  if (scoped.length === 1) return scoped[0];
  if (scoped.length > 1) {
    const bySgg = scoped.filter((row) => context.includes(row.sgg));
    return bySgg[0] ?? null;
  }
  if ((rows[0]?.name.length ?? 0) <= 2) return null;
  const byAdmin = plausible.filter(
    (row) => context.includes(row.sgg) || (row.sido.length >= 2 && context.includes(row.sido)),
  );
  return byAdmin.length === 1 ? byAdmin[0] : null;
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

export function extractCbsSenders(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(SENDER_RE)) {
    const name = match[1].trim().replace(/\s+/g, " ").replace(SENDER_OFFICE, "");
    const normalized = /(시|군|구)청$/.test(name) ? name.replace(/청$/, "") : name;
    if (normalized.length >= 2 && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

export function adminSenderNames(text: string): string[] {
  return extractCbsSenders(text).filter((name) => /(특별자치시|광역시|특별시|특별자치도|시|군|구)$/.test(name));
}

export function unambiguousAdminSenders(text: string): string[] {
  return adminSenderNames(text).filter((name) => {
    const token = name.split(/\s+/).pop() ?? name;
    return !AMBIGUOUS_SGG.has(token);
  });
}

function cityTokens(name: string): string[] {
  return [...name.matchAll(CITY_TOKEN_RE)].map((match) => match[1]);
}

const SENDER_CITY_ALIAS: Record<string, string> = {
  서울시: "서울특별시",
  부산시: "부산광역시",
  대구시: "대구광역시",
  인천시: "인천광역시",
  대전시: "대전광역시",
  울산시: "울산광역시",
  세종시: "세종특별자치시",
};

function citiesCompatible(locCity: string, senderCity: string): boolean {
  if (locCity === senderCity) return true;
  const senderCanon = SENDER_CITY_ALIAS[senderCity] ?? senderCity;
  const locCanon = SENDER_CITY_ALIAS[locCity] ?? locCity;
  return locCity === senderCanon || locCanon === senderCity || locCanon === senderCanon;
}

export function locationFitsSenders(loc: string, senders: string[]): boolean {
  const senderCities = senders.flatMap(cityTokens);
  if (senderCities.length === 0) return true;
  const locCities = cityTokens(loc);
  if (locCities.length === 0) return true;
  return locCities.some((city) => senderCities.some((sender) => citiesCompatible(city, sender)));
}

export function extractGazetteerHits(text: string, hint = ""): GazetteerHit[] {
  const db = load();
  const senders = extractCbsSenders(text);
  const context = `${text}\n${hint}\n${senders.join("\n")}`;
  const hits: GazetteerHit[] = [];

  const add = (hit: GazetteerHit) => {
    if (hits.some((row) => row.start === hit.start && row.end === hit.end)) return;
    hits.push(hit);
  };

  for (const sido of db.sidoNeed) {
    for (const start of indexesOf(text, sido.name)) {
      if (!isolatedHangul(text, start, sido.name.length)) continue;
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
      if (!isolatedHangul(text, start, name.length)) continue;
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
      if (!isolatedHangul(text, start, name.length)) continue;
      if (/제외/.test(text.slice(start + name.length, start + name.length + 8))) continue;
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
      if (!isolatedHangul(text, start, name.length)) continue;
      const row = pickRi(rows, context);
      if (!row) continue;
      const label = fullLabel("ri", row);
      if (!locationFitsSenders(label, senders)) continue;
      add({
        text: name,
        label,
        type: "ri",
        start,
        end: start + name.length,
        sido: displaySido(row.sido, row.sgg),
        sgg: row.sgg,
      });
    }
  }

  for (const match of text.matchAll(/([가-힣0-9]{1,12}(?:읍|면|동))\s*([가-힣0-9]{2,8}리)/g)) {
    const emd = match[1];
    const name = match[2];
    if (/^(우리|무리)$/.test(name) || /거리$/.test(name)) continue;
    const start = (match.index ?? 0) + match[0].length - name.length;
    if (!isolatedHangul(text, start, name.length)) continue;
    if (hits.some((hit) => hit.start <= start && hit.end >= start + name.length)) continue;
    const emdHit = hits.find((hit) => hit.type === "emd" && hit.text === emd);
    const sender = adminSenderNames(text)[0];
    const label = [emdHit?.label || sender, name].filter(Boolean).join(" ");
    if (!label) continue;
    add({
      text: name,
      label,
      type: "ri",
      start,
      end: start + name.length,
      sido: emdHit?.sido,
      sgg: emdHit?.sgg,
    });
  }

  for (const match of text.matchAll(/([가-힣0-9]{2,7}(?:읍|면|동))/g)) {
    const name = match[1];
    const start = match.index ?? 0;
    if (!isolatedHangul(text, start, name.length)) continue;
    if (/(활동|운동|행동|방역|방면|이동)$/.test(name) || /^\d+동$/.test(name)) continue;
    if (name === "비탈면" || name === "경사면") continue;
    if (VERB_MYEON_TAIL.test(name) && !KNOWN_MYEON.has(name) && !db.emdByName.has(name)) continue;
    if (/제외/.test(text.slice(start + name.length, start + name.length + 8))) continue;
    if (hits.some((hit) => hit.start <= start && hit.end >= start + name.length)) continue;
    const sender = adminSenderNames(text)[0];
    const label = sender ? `${sender} ${name}` : name;
    add({
      text: name,
      label,
      type: "emd",
      start,
      end: start + name.length,
    });
  }

  for (const match of text.matchAll(FACILITY_RE)) {
    const value = match[0];
    if (value.length < 2 || FACILITY_SKIP.test(value)) continue;
    const start = match.index ?? 0;
    const after = text[start + value.length] ?? "";
    const rest = text.slice(start + value.length);
    if (/교$/.test(value) && /[가-힣]/.test(after)) continue;
    if (/역$/.test(value) && /^(?:\s*방면|사거리|거리)/.test(rest)) continue;
    if (/역$/.test(value) && /(?:구제역|제역)$/.test(value)) continue;
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

export function isSpuriousLocationToken(token: string): boolean {
  const name = token.trim().split(/\s+/).pop() ?? "";
  if (!name) return true;
  if (name === "구제역" || /제역$/.test(name)) return true;
  if (/[삼사오육칠팔구]거리$/.test(name)) return true;
  if (VERB_MYEON_TAIL.test(name) && !KNOWN_MYEON.has(name) && !load().emdByName.has(name)) return true;
  return false;
}

export function gazetteerLocations(text: string, extra: string[] = []): string[] {
  const hits = extractGazetteerHits(text, extra.join(" "));
  const labels: string[] = [];
  for (const item of extra) {
    const glued = item.replace(/,\s*(?=[가-힣0-9]{2,25}(?:대로|로|길))/g, " ");
    for (const part of glued.split(/[,/·]/)) {
      const trimmed = canonAdminLabel(part);
      if (trimmed && !isSpuriousLocationToken(trimmed) && !labels.includes(trimmed)) labels.push(trimmed);
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
