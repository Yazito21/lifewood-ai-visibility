export type BrandProfile = {
  summary: string;
  offerings: string[];
  audiences: string[];
  markets: string[];
  differentiators: string[];
};

const MAX_LIST_ITEMS = 8;
const MAX_PROMPT_CHARS = 300;

function invalid(): never {
  throw new Error("MODEL_JSON_INVALID");
}

function tryParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

/** Parses the model reply as JSON: raw, inside a ```json fence, or the outermost {...} span. */
export function extractJson(text: string): unknown {
  const raw = tryParse(text.trim());
  if (raw !== undefined) return raw;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const fromFence = fenced ? tryParse(fenced.trim()) : undefined;
  if (fromFence !== undefined) return fromFence;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const span = start >= 0 && end > start ? tryParse(text.slice(start, end + 1)) : undefined;
  if (span !== undefined) return span;
  invalid();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim()).slice(0, MAX_LIST_ITEMS);
}

export function parseProfile(text: string): BrandProfile {
  const data = extractJson(text) as Record<string, unknown> | null;
  const summary = typeof data?.summary === "string" ? data.summary.trim() : "";
  if (!summary) invalid();
  return {
    summary,
    offerings: stringList(data?.offerings),
    audiences: stringList(data?.audiences),
    markets: stringList(data?.markets),
    differentiators: stringList(data?.differentiators),
  };
}

export function parseSuggestions(text: string): string[] {
  const data = extractJson(text) as Record<string, unknown> | null;
  if (!Array.isArray(data?.prompts)) invalid();
  return (data.prompts as unknown[])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item && item.length <= MAX_PROMPT_CHARS);
}
