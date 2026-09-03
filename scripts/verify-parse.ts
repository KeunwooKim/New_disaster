import { classifyDisasterType, parseCbsByRules } from "../src/lib/rules";

const cases: Array<{ text: string; type: string; forbid?: string[]; allow?: string[] }> = [
  {
    text: "집중 호우로 하수구가 역류하면 지상으로 대피하세요. [계양구청]",
    type: "호우",
    forbid: ["역류하면"],
    allow: ["계양구"],
  },
  {
    text: "선결제 요구하면 무조건 보이스피싱. 절대 응하지 마세요!! [거제시청]",
    type: "기타",
    forbid: ["요구하면"],
  },
  {
    text: "폭염이 길어질수록 작은 어지럼도 방심하면 안됩니다. [양구군]",
    type: "폭염",
    forbid: ["방심하면"],
  },
  {
    text: "08:27 고창군 상하면 인근 50mm/h 이상 강한 비로 침수 등 우려 [기상청]",
    type: "호우",
    allow: ["상하면"],
  },
  {
    text: "9월 3일 예천군 감천면 축산농장 구제역 발생에 따라 차단방역 [예천군]",
    type: "구제역",
    forbid: ["구제역"],
    allow: ["예천군"],
  },
  {
    text: "금일 긴급 상수도 보수공사로 매탄권선역사거리(동탄방향) 차량 혼잡 [수원특례시]",
    type: "기타",
    forbid: ["매탄권선역"],
  },
  {
    text: "오늘 22:30 강풍주의보. 야외 활동과 차량 운행 자제. [행정안전부]",
    type: "강풍",
  },
  {
    text: "댐 방류로 하류 수위가 상승할 수 있으니 하천 접근을 금지합니다. [충주시]",
    type: "기타",
  },
  {
    text: "호우주의보. 하천 수위 상승, 방류에 주의. [충주시]",
    type: "호우",
  },
  {
    text: "강풍에 서행 운전하시기 바랍니다. [속초시]",
    type: "강풍",
  },
  {
    text: "폭죽 폭발에 주의하시기 바랍니다. [송파구]",
    type: "기타",
  },
];

let failed = 0;
for (const row of cases) {
  const parsed = parseCbsByRules(row.text, [], "cbs");
  const type = classifyDisasterType(row.text).type;
  const locs = parsed.locations.join(" | ");
  const problems: string[] = [];
  if (type !== row.type) problems.push(`type ${type} != ${row.type}`);
  for (const bad of row.forbid ?? []) {
    if (parsed.locations.some((loc) => loc.includes(bad) && !(row.allow ?? []).some((ok) => ok === bad))) {
      problems.push(`loc has ${bad}: ${locs}`);
    }
  }
  for (const ok of row.allow ?? []) {
    if (!parsed.locations.some((loc) => loc.includes(ok))) problems.push(`missing ${ok}: ${locs}`);
  }
  if (problems.length > 0) {
    failed += 1;
    console.log("FAIL", row.text.slice(0, 40), problems);
  } else {
    console.log("ok", row.type, locs || "(none)");
  }
}
if (failed > 0) {
  process.exit(1);
}
console.log("all passed");
