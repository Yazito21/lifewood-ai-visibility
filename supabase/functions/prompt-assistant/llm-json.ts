import { extractJson } from "../_shared/json-extract.ts";

export { extractJson };

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
