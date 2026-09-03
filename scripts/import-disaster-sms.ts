import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { insertEvent } from "../src/lib/db";
import { lookupCentroid } from "../src/lib/region-centroids";
import { parseCbsByRules } from "../src/lib/rules";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "data", "raw", "disaster-sms.jsonl");

type ArchiveRow = {
  sn?: number | string;
  title?: string;
  sender?: string | null;
  registered_at?: string;
  url?: string;
};

function parseOccurredAt(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 14) {
    const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}+09:00`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const years = new Set(process.argv.slice(2).filter((value) => /^\d{4}$/.test(value)));
  if (!fs.existsSync(SRC)) {
    throw new Error(`missing archive: ${SRC}`);
  }

  const input = fs.createReadStream(SRC, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let scanned = 0;
  let matched = 0;
  let inserted = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    scanned += 1;
    const row = JSON.parse(line) as ArchiveRow;
    const title = row.title?.trim();
    const at = row.registered_at?.trim() ?? "";
    if (!title || !at) continue;
    if (years.size > 0 && !years.has(at.slice(0, 4))) continue;
    matched += 1;
    const sn = row.sn != null ? String(row.sn) : "";
    const regions = row.sender?.trim() ? [row.sender.trim()] : [];
    const analysis = parseCbsByRules(title, regions, "cbs");
    const query = analysis.locations[0] ?? regions[0];
    const centroid = query ? lookupCentroid(query) : null;
    if (
      insertEvent({
        id: `cbs:${sn || Buffer.from(title).toString("base64url").slice(0, 24)}`,
        source: "cbs",
        occurredAt: parseOccurredAt(at),
        rawText: title,
        rawJson: row,
        regions,
        analysis,
        analysisStatus: "rules",
        lat: centroid?.[0] ?? null,
        lng: centroid?.[1] ?? null,
        geocodeStatus: centroid ? "centroid" : "pending",
      })
    ) {
      inserted += 1;
    }
    if (matched % 5000 === 0) {
      console.log(`scanned=${scanned} matched=${matched} inserted=${inserted}`);
    }
  }

  console.log(JSON.stringify({ scanned, matched, inserted, years: [...years] }));
}

void main();
