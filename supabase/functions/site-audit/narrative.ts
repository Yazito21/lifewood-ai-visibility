import { extractJson } from "../_shared/json-extract.ts";
import type { ChatMessage } from "../_shared/openrouter.ts";
import type { EeatDimension, EeatResult } from "./types.ts";

export const PILLAR_KEYS = ["website", "knowledge", "authority", "community", "monitoring"] as const;
export type PillarKey = (typeof PILLAR_KEYS)[number];

export type Narrative = {
  executiveSummary: { position: string[] };
  kpiNotes: { visibility: string; rank: string; citations: string; shareOfVoice: string };
  competitorSummary: string;
  pillars: Record<PillarKey, { position: string[] }>;
  targetNotes: string;
  fallback?: true;
};

export type NarrativeInput = { brand: string; facts: Record<string, unknown> };

const MAX_EEAT_PAGES = 5;
const MAX_EEAT_WORDS = 6000;
const MAX_ITEMS = 3;

function invalid(): never {
  throw new Error("MODEL_JSON_INVALID");
}

export function eeatMessages(brand: string, pages: { url: string; text: string }[]): ChatMessage[] {
  const chosen = pages.slice(0, MAX_EEAT_PAGES);
  const perPage = Math.floor(MAX_EEAT_WORDS / Math.max(1, chosen.length));
  const body = chosen.map((page) => `URL: ${page.url}\n${page.text.split(/\s+/).filter(Boolean).slice(0, perPage).join(" ")}`).join("\n\n");
  return [
    {
      role: "system",
      content: "You assess website content quality for Google's E-E-A-T guidelines (Experience, Expertise, Authoritativeness, " +
        "Trustworthiness). Score each dimension from 0 to 25 using only the page text given. Reply with JSON only: " +
        '{"experience":{"score":number,"evidence":string},"expertise":{"score":number,"evidence":string},' +
        '"authoritativeness":{"score":number,"evidence":string},"trustworthiness":{"score":number,"evidence":string}}. ' +
        "Each evidence is one short quote or observation from the pages (under 25 words).",
    },
    { role: "user", content: `Brand: ${brand}\n\n${body}` },
  ];
}

function dimension(value: unknown): EeatDimension {
  const raw = value as { score?: unknown; evidence?: unknown } | null;
  const score = Number(raw?.score);
  if (!raw || !Number.isFinite(score)) invalid();
  return { score: Math.round(Math.max(0, Math.min(25, score))), evidence: typeof raw.evidence === "string" ? raw.evidence.trim().slice(0, 300) : "" };
}

export function parseEeat(text: string): EeatResult {
  const data = extractJson(text) as Record<string, unknown> | null;
  return {
    experience: dimension(data?.experience),
    expertise: dimension(data?.expertise),
    authoritativeness: dimension(data?.authoritativeness),
    trustworthiness: dimension(data?.trustworthiness),
  };
}

export function narrativeMessages(input: NarrativeInput): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You write the text of a client-facing AI visibility and website audit report for the brand in the input. Lifewood produces the report.",
        "Write in plain, confident business English for the client's marketing leadership. Be specific and tie every point to the findings.",
        "Use only numbers that appear in the input. Never invent numbers, percentages, dates or rankings.",
        'Say "AI visibility", never "AEO". Never write "Prepared by" or name an author.',
        "Do not describe services or offers; describe the brand's current position only.",
        "Reply with JSON only, shaped as:",
        '{"executiveSummary":{"position":[3 strings]},"kpiNotes":{"visibility":string,"rank":string,"citations":string,"shareOfVoice":string},' +
          '"competitorSummary":string,"pillars":{"website":{"position":[3 strings]},"knowledge":{"position":[3 strings]},' +
          '"authority":{"position":[3 strings]},"community":{"position":[3 strings]},"monitoring":{"position":[3 strings]}},"targetNotes":string}',
        "Pillars: website = website content & structure; knowledge = knowledge assets & resources; authority = branding & authority; " +
          "community = community engagement; monitoring = monitoring & research. Each string is one sentence under 30 words. " +
          "kpiNotes are one short sentence each.",
      ].join("\n"),
    },
    { role: "user", content: `Brand: ${input.brand}\nFindings and measurements (JSON):\n${JSON.stringify(input.facts)}` },
  ];
}

const NUMBER = /\d+(?:[.,]\d+)*%?/g;

function normaliseNumber(token: string): string {
  const cleaned = token.replace(/%$/, "").replace(/,(?=\d{3}\b)/g, "");
  const value = Number(cleaned.replace(/,/g, "."));
  return Number.isFinite(value) ? String(value) : cleaned;
}

/** Every number written in a piece of text, normalised (thousands separators and % removed). */
export function numbersIn(text: string): Set<string> {
  return new Set((text.match(NUMBER) ?? []).map(normaliseNumber));
}

function addNumber(set: Set<string>, value: number) {
  if (!Number.isFinite(value)) return;
  for (const n of [value, Math.round(value), Math.round(value * 10) / 10, Math.abs(value), Math.round(Math.abs(value))]) set.add(String(n));
}

/**
 * Numbers the report text may use: numeric values in the input (and their rounded forms) plus numbers
 * written in the deterministic findings. Numbers inside other strings (dates, URLs, prompt text) do not count.
 */
export function allowedNumbers(input: NarrativeInput): Set<string> {
  const allowed = new Set<string>();
  const walk = (value: unknown, inFindings: boolean) => {
    if (typeof value === "number") addNumber(allowed, value);
    else if (typeof value === "string") {
      if (inFindings) for (const n of numbersIn(value)) allowed.add(n);
    } else if (Array.isArray(value)) value.forEach((item) => walk(item, inFindings));
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, inFindings || key === "findings");
    }
  };
  walk(input.facts, false);
  return allowed;
}

/** Removes sentences that contain a number not in the allowed set. */
export function stripUnknownNumbers(text: string, allowed: Set<string>): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => (sentence.match(NUMBER) ?? []).every((n) => allowed.has(normaliseNumber(n))));
  return kept.map((s) => s.trim()).filter(Boolean).join(" ");
}

/**
 * Parses the narrative and applies the number guard. Throws MODEL_JSON_INVALID when the reply is empty or
 * when more than half of its text was removed by the guard, so the plain-findings fallback is used instead.
 */
export function parseNarrative(text: string, allowed: Set<string>): Narrative {
  const data = extractJson(text) as Record<string, any> | null;
  if (!data || typeof data !== "object") invalid();
  let generated = 0;
  let kept = 0;
  const str = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim()) return "";
    generated++;
    const clean = stripUnknownNumbers(value.trim(), allowed);
    if (clean) kept++;
    return clean;
  };
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.slice(0, MAX_ITEMS).map(str).filter(Boolean) : []);
  const pillars = Object.fromEntries(PILLAR_KEYS.map((key) => [key, { position: list(data.pillars?.[key]?.position) }])) as Narrative["pillars"];
  const narrative: Narrative = {
    executiveSummary: { position: list(data.executiveSummary?.position) },
    kpiNotes: {
      visibility: str(data.kpiNotes?.visibility),
      rank: str(data.kpiNotes?.rank),
      citations: str(data.kpiNotes?.citations),
      shareOfVoice: str(data.kpiNotes?.shareOfVoice),
    },
    competitorSummary: str(data.competitorSummary),
    pillars,
    targetNotes: str(data.targetNotes),
  };
  if (generated === 0 || kept * 2 < generated) invalid();
  return narrative;
}

const FALLBACK_SOURCES: Record<PillarKey, string[]> = {
  website: ["technical", "seo", "schema"],
  knowledge: ["citability", "eeat"],
  authority: ["brand"],
  community: [],
  monitoring: ["platform"],
};

/** Plain findings in place of AI-written text, used when the AI call fails. */
export function fallbackNarrative(findings: Record<string, string[]>): Narrative {
  const pillars = Object.fromEntries(
    PILLAR_KEYS.map((key) => [key, { position: FALLBACK_SOURCES[key].flatMap((source) => findings[source] ?? []).slice(0, MAX_ITEMS) }]),
  ) as Narrative["pillars"];
  return {
    executiveSummary: { position: Object.values(findings).map((items) => items[0]).filter(Boolean).slice(0, MAX_ITEMS) },
    kpiNotes: { visibility: "", rank: "", citations: "", shareOfVoice: "" },
    competitorSummary: "",
    pillars,
    targetNotes: "",
    fallback: true,
  };
}
