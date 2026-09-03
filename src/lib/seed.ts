import { insertEvent, updateAnalysis, updateCoords } from "./db";
import { lookupCentroid } from "./region-centroids";
import { parseCbsByRules } from "./rules";

const SAMPLES = [
  {
    id: "sample:cbs-seoul-rain",
    source: "cbs" as const,
    occurredAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    rawText:
      "[서울특별시] 오늘 15시 강남구·송파구 호우주의보. 저지대 침수 위험, 외출을 자제하고 지하차도 진입을 금지하세요.",
    regions: ["서울특별시 강남구"],
  },
  {
    id: "sample:cbs-busan-heat",
    source: "cbs" as const,
    occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    rawText:
      "[부산광역시] 폭염경보. 온열질환에 주의하고 그늘에서 휴식하세요. 노약자는 낮 시간 외출을 피하세요.",
    regions: ["부산광역시"],
  },
  {
    id: "sample:cbs-jeju-typhoon",
    source: "cbs" as const,
    occurredAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    rawText:
      "[제주특별자치도] 태풍 접근. 해안가 접근 금지, 간판·시설물 고정, 위험지역 주민은 지정 대피소로 이동하세요.",
    regions: ["제주특별자치도"],
  },
  {
    id: "sample:missing-daejeon",
    source: "missing" as const,
    occurredAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    rawText:
      "성명 홍길동. 대상 치매질환자. 성별 남자. 당시나이 78. 발생장소 대전광역시 서구 둔산동. 착의 회색 점퍼, 검정 바지. 특징 짧은 흰머리, 지팡이 사용.",
    regions: ["대전광역시 서구"],
    photoUrl: null as string | null,
  },
  {
    id: "sample:missing-incheon",
    source: "missing" as const,
    occurredAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
    rawText:
      "성명 김민아. 대상 아동. 성별 여자. 당시나이 8. 발생장소 인천광역시 남동구. 착의 분홍 후드, 청바지. 특징 단발머리, 분홍 운동화.",
    regions: ["인천광역시 남동구"],
    photoUrl: null as string | null,
  },
];

export function seedIfEmpty(): number {
  let inserted = 0;
  for (const sample of SAMPLES) {
    if (!insertEvent(sample)) continue;
    inserted += 1;
    const analysis = parseCbsByRules(sample.rawText, sample.regions, sample.source);
    updateAnalysis(sample.id, analysis, "rules", analysis.locations);
    const query = analysis.locations[0] ?? sample.regions[0];
    const centroid = query ? lookupCentroid(query) : null;
    if (centroid) updateCoords(sample.id, centroid[0], centroid[1], "centroid");
  }
  return inserted;
}
