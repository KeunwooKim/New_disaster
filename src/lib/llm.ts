import { InferenceClient } from "@huggingface/inference";
import { extractNerEntities } from "./ner";
import { parseCbsByRules } from "./rules";
import type { AlertEvent, AnalysisStatus, LlmAnalysis } from "./types";

const SYSTEM_PROMPT = `한국 재난문자·실종 안내에서 장소만 추출합니다.
JSON만 출력하세요. 다른 필드는 금지입니다.
{"locations": ["서울특별시 강남구", "서울특별시 송파구"]}

규칙:
- 시·도, 시·군·구, 읍·면·동·리, 도로·교량·시설·지명만 넣습니다.
- 가운데점(·)이나 쉼표로 나뉜 구·동은 각각 따로 넣습니다.
- 원문에 없는 지명은 만들지 않습니다.
- 지명이 없으면 {"locations": []}
- "알려진 지역"은 힌트입니다. 본문이 더 구체우면 본문을 따릅니다.`;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON 없음");
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function uniqueLocations(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function locationsFromModel(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  if (!Array.isArray(rec.locations)) return [];
  return uniqueLocations(
    rec.locations.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
  );
}

async function complete(model: string, token: string, user: string): Promise<string> {
  const client = new InferenceClient(token);
  const result = await client.chatCompletion({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    max_tokens: 220,
    temperature: 0,
  });
  const message = result.choices[0]?.message;
  const content = message?.content;
  if (typeof content === "string" && content.trim()) return content;
  const reasoning = (message as { reasoning_content?: unknown } | undefined)?.reasoning_content;
  if (typeof reasoning === "string" && reasoning.trim()) return reasoning;
  return "";
}

function withLocations(base: LlmAnalysis, locations: string[], source: AlertEvent["source"]): LlmAnalysis {
  const resolved = locations.length > 0 ? locations : base.locations;
  return {
    ...base,
    locations: resolved,
    lastSeen: source === "missing" ? resolved[0] ?? base.lastSeen : undefined,
  };
}

export async function analyzeEvent(
  event: AlertEvent,
): Promise<{ analysis: LlmAnalysis; status: AnalysisStatus }> {
  const nerEntities = await extractNerEntities(event.rawText);
  const extras = [
    ...event.regions,
    ...(nerEntities ?? []).map((row) => row.text),
  ];
  const fallback = parseCbsByRules(event.rawText, extras, event.source);
  if (nerEntities && nerEntities.length > 0) {
    return { analysis: fallback, status: "ner" };
  }

  const token = process.env.HF_TOKEN;
  if (!token) return { analysis: fallback, status: "rules" };

  const primary = process.env.HF_MODEL || "moonshotai/Kimi-K2-Instruct";
  const secondary = process.env.HF_MODEL_FALLBACK || "zai-org/GLM-5.3";
  const user = [
    `알려진 지역: ${event.regions.join(", ") || "없음"}`,
    `원문:\n${event.rawText}`,
  ].join("\n");

  for (const model of [primary, secondary]) {
    try {
      const content = await complete(model, token, user);
      const modelLocs = locationsFromModel(extractJson(content));
      if (modelLocs.length === 0) continue;
      const locations = uniqueLocations([...fallback.locations, ...modelLocs]);
      return { analysis: withLocations(fallback, locations, event.source), status: "llm" };
    } catch {
      // try next model
    }
  }
  return { analysis: fallback, status: "rules" };
}
