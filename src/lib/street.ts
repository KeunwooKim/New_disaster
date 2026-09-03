/** 도로명주소: `인더스파크로 70`, `지족로148번길`, `화곡로 10길`, `양녕로22가길` */

const BRANCH_TAIL = "(?:번길|번지|[가나다라마바사아자차카타파하]?길)";
const STREET_RE = new RegExp(
  `([가-힣0-9]{2,25}(?:대로|로|길))\\s*(\\d+(?:-\\d+)?)(${BRANCH_TAIL})?`,
  "g",
);

const ROAD_SKIP = /으로$|고속도로$|자동차전용도로$|전용도로$|하상도로$/;
const STEM_SKIP = /^(것|수|일|때|뒤|후|전|중|등|및|작업|발생|진화|통제|완진|복구작업|화재발생|교통통제)$/;

function lastToken(name: string): string {
  return name.trim().split(/\s+/).pop() ?? name;
}

export function isRoadName(value: string): boolean {
  const token = lastToken(value);
  if (token.length < 3 || ROAD_SKIP.test(token) || /도로$/.test(token)) return false;
  return /[가-힣0-9]+(?:대로|로|길)$/.test(token);
}

export function isStreetAddress(value: string): boolean {
  return (
    new RegExp(`(?:대로|로|길)\\s*\\d+(?:-\\d+)?${BRANCH_TAIL}?`).test(value) ||
    /(?:대로|로)\d+[가나다라마바사아자차카타파하]길/.test(value) ||
    isRoadName(value)
  );
}

export function extractStreetAddresses(text: string): string[] {
  const out: string[] = [];
  STREET_RE.lastIndex = 0;
  for (const match of text.matchAll(STREET_RE)) {
    const road = match[1];
    const num = match[2];
    const tail = match[3] ?? "";
    if (!road || !num) continue;
    if (ROAD_SKIP.test(road)) continue;
    const stem = road.replace(/(?:대로|로|길)$/, "");
    if (STEM_SKIP.test(stem)) continue;
    let label = `${road} ${num}`;
    if (tail) label += tail;
    label = label.replace(/\s+/g, " ").trim();
    if (label.length >= 4 && !out.includes(label)) out.push(label);
  }
  return out;
}

function adminRank(name: string): number {
  const token = lastToken(name);
  if (/[동리]$/.test(token) || /동\s*\d/.test(name)) return 4;
  if (/[읍면]$/.test(token)) return 3;
  if (/구$/.test(token) && !/(특별시|광역시|특별자치시)$/.test(token)) return 2;
  if (/[시군]$/.test(token) && !/(특별시|광역시|특별자치시)$/.test(token)) return 1;
  return 0;
}

export function attachStreetToAdmin(street: string, admins: string[]): string {
  const compactStreet = street.replace(/\s+/g, "");
  const already = admins.find((name) => name.replace(/\s+/g, "").includes(compactStreet));
  if (already) return already;
  const parent = [...admins].sort((a, b) => adminRank(b) - adminRank(a) || b.length - a.length)[0];
  if (!parent || adminRank(parent) === 0) return street;
  if (compactStreet.includes(parent.replace(/\s+/g, ""))) return street;
  return `${parent} ${street}`;
}

export function mergeStreetLocations(text: string, locations: string[]): string[] {
  const streets = extractStreetAddresses(text);
  if (streets.length === 0) return locations;
  const admins = locations.filter((name) => !isStreetAddress(name));
  const attached = streets.map((street) => attachStreetToAdmin(street, admins));
  const out = [...locations];
  for (const item of attached) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}
