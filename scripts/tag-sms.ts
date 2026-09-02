import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { extractGazetteerHits } from "../src/lib/gazetteer";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "data", "raw", "disaster-sms.jsonl");
const OUT_DIR = path.join(ROOT, "data", "ner");
const OUT = path.join(OUT_DIR, "silver.jsonl");
const META = path.join(OUT_DIR, "silver.meta.json");

async function main() {
  process.chdir(ROOT);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const input = fs.createReadStream(SRC, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const out = fs.createWriteStream(OUT, { encoding: "utf8" });

  const stats = {
    total: 0,
    withSpan: 0,
    withSgg: 0,
    withEmd: 0,
    withRi: 0,
    withFacility: 0,
    sidoOnly: 0,
    empty: 0,
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as { title?: string; sender?: string; sn?: number };
    const text = rec.title ?? "";
    const hits = extractGazetteerHits(text);
    stats.total += 1;
    const types = new Set(hits.map((hit) => hit.type));
    if (hits.length > 0) stats.withSpan += 1;
    else stats.empty += 1;
    if (types.has("sgg")) stats.withSgg += 1;
    if (types.has("emd")) stats.withEmd += 1;
    if (types.has("ri")) stats.withRi += 1;
    if (types.has("facility")) stats.withFacility += 1;
    if (types.has("sido") && !types.has("sgg") && !types.has("emd") && !types.has("ri")) stats.sidoOnly += 1;

    out.write(
      `${JSON.stringify({
        sn: rec.sn,
        sender: rec.sender ?? "",
        text,
        spans: hits.map((hit) => ({
          start: hit.start,
          end: hit.end,
          text: hit.text,
          label: hit.label,
          type: hit.type,
        })),
      })}\n`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", reject);
  });

  const meta = {
    ...stats,
    out: OUT,
    bytes: fs.statSync(OUT).size,
    coverage: {
      any: Number((stats.withSpan / stats.total).toFixed(4)),
      sgg: Number((stats.withSgg / stats.total).toFixed(4)),
      emd: Number((stats.withEmd / stats.total).toFixed(4)),
      ri: Number((stats.withRi / stats.total).toFixed(4)),
    },
  };
  fs.writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
