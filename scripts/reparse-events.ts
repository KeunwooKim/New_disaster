import { listEvents, updateAnalysis } from "../src/lib/db";
import { parseCbsByRules } from "../src/lib/rules";

async function main(): Promise<void> {
  let scanned = 0;
  let updated = 0;
  for (const source of ["cbs", "missing"] as const) {
    const events = listEvents(source, 100_000);
    for (const event of events) {
      if (event.analysisStatus === "pending") continue;
      scanned += 1;
      const parsed = parseCbsByRules(event.rawText, [], source);
      const prev = event.llm;
      const next = {
        ...parsed,
        appearance: prev?.appearance ?? parsed.appearance,
        clothing: prev?.clothing ?? parsed.clothing,
        lastSeen: source === "missing" ? parsed.locations[0] ?? prev?.lastSeen : undefined,
      };
      if (JSON.stringify(next) === JSON.stringify(prev) && event.analysisStatus === "rules") continue;
      updateAnalysis(event.id, next, "rules", next.locations);
      updated += 1;
      if (updated % 5000 === 0) console.log(`updated=${updated} scanned=${scanned}`);
    }
  }
  console.log(JSON.stringify({ scanned, updated }));
}

void main();
