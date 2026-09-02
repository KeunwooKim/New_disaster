export type NerEntity = {
  start: number;
  end: number;
  label: string;
  score: number;
  text: string;
};

const NER_URL = process.env.NER_URL || "http://127.0.0.1:3002";

export async function extractNerEntities(text: string): Promise<NerEntity[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${NER_URL}/ner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { entities?: NerEntity[] };
    return Array.isArray(data.entities) ? data.entities : [];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
