export type RegionProps = {
  code: string;
  name: string;
  name_eng?: string;
  kind: "sido" | "sgg";
  sido: string;
};

export type RegionFeature = {
  type: "Feature";
  properties: RegionProps;
  geometry: object;
};

export type RegionCollection = {
  type: "FeatureCollection";
  features: RegionFeature[];
};

const SIDO_ALIAS: Record<string, string> = {
  서울: "서울특별시",
  서울시: "서울특별시",
  부산: "부산광역시",
  대구: "대구광역시",
  인천: "인천광역시",
  광주: "광주광역시",
  대전: "대전광역시",
  울산: "울산광역시",
  세종: "세종특별자치시",
  경기: "경기도",
  강원: "강원도",
  강원도: "강원도",
  강원특별자치도: "강원도",
  충북: "충청북도",
  충남: "충청남도",
  전북: "전라북도",
  전라북도: "전라북도",
  전북특별자치도: "전라북도",
  전남: "전라남도",
  경북: "경상북도",
  경남: "경상남도",
  제주: "제주특별자치도",
  제주도: "제주특별자치도",
  전남광주통합특별시: "전라남도",
};

const SIDO_CANON = [
  "제주특별자치도",
  "세종특별자치시",
  "강원특별자치도",
  "전북특별자치도",
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "경기도",
  "강원도",
  "충청북도",
  "충청남도",
  "전라북도",
  "전라남도",
  "경상북도",
  "경상남도",
];

function compact(name: string): string {
  return name.replace(/\s+/g, "");
}

function canonSido(name: string): string {
  const trimmed = name.trim();
  return SIDO_ALIAS[trimmed] ?? SIDO_ALIAS[compact(trimmed)] ?? trimmed;
}

function parseLocation(location: string): { sido: string | null; sgg: string | null } {
  const jeonnamGwangju = location.includes("전남광주통합특별시");
  let rest = location.replace(/전남광주통합특별시/g, "전라남도").replace(/\s+/g, " ").trim();
  let sido: string | null = null;
  const sorted = [...SIDO_CANON, ...Object.keys(SIDO_ALIAS)].sort((a, b) => b.length - a.length);
  for (const token of sorted) {
    if (rest === token || rest.startsWith(`${token} `) || (rest.startsWith(token) && rest.length > token.length)) {
      sido = canonSido(token);
      rest = rest.slice(token.length).trim();
      break;
    }
  }
  const tokens = [...rest.matchAll(/([가-힣]+(?:시|군|구))/g)].map((m) => m[1]);
  let sgg: string | null = null;
  if (rest === "전체") {
    sgg = null;
  } else if (tokens.length >= 2 && /시$/.test(tokens[0]) && /구$/.test(tokens[1])) {
    sgg = compact(tokens[0] + tokens[1]);
  } else if (tokens.length > 0) {
    sgg = compact(tokens[0]);
  } else if (rest) {
    sgg = compact(rest);
  }
  if (!sgg && sido && /(?:시|군|구)$/.test(sido) && !/(특별시|광역시|특별자치시)$/.test(sido)) {
    return { sido: null, sgg: compact(sido) };
  }
  if (jeonnamGwangju && sgg && ["동구", "서구", "남구", "북구", "광산구"].includes(sgg)) {
    sido = "광주광역시";
  }
  return { sido, sgg };
}

export function matchRegionFeatures(location: string, geo: RegionCollection): RegionFeature[] {
  const { sido, sgg } = parseLocation(location);
  const sggList = geo.features.filter((feature) => feature.properties.kind === "sgg");
  const sidoList = geo.features.filter((feature) => feature.properties.kind === "sido");

  if (sgg) {
    const exact = sggList.filter((feature) => feature.properties.name === sgg);
    const prefixed = sggList.filter(
      (feature) => feature.properties.name.startsWith(sgg) && /[시군]$/.test(sgg),
    );
    const suffixed = sggList.filter(
      (feature) => /구$/.test(sgg) && feature.properties.name.endsWith(sgg) && feature.properties.name !== sgg,
    );
    let hits = exact.length > 0 ? exact : prefixed.length > 0 ? prefixed : suffixed;
    if (sido) {
      const scoped = hits.filter((feature) => feature.properties.sido === sido);
      if (scoped.length > 0) hits = scoped;
    }
    if (hits.length === 0) {
      const parentSi = sgg.match(/^([가-힣]+시)/)?.[1];
      if (parentSi && parentSi !== sgg) {
        hits = sggList.filter(
          (feature) =>
            feature.properties.name === parentSi && (!sido || feature.properties.sido === sido),
        );
      }
    }
    if (hits.length > 0) return hits;
    return [];
  }

  if (sido) {
    const hit = sidoList.find((feature) => feature.properties.name === sido);
    if (hit) return [hit];
  }
  return [];
}

export function featuresForLocations(locations: string[], geo: RegionCollection): RegionFeature[] {
  const seen = new Set<string>();
  const out: RegionFeature[] = [];
  for (const location of locations) {
    for (const feature of matchRegionFeatures(location, geo)) {
      if (seen.has(feature.properties.code)) continue;
      seen.add(feature.properties.code);
      out.push(feature);
    }
  }
  return out;
}
