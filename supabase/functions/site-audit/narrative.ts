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

/** Removes sentences that contain a number not present in the allowed text. */
export function stripUnknownNumbers(text: string, allowedText: string): string {
  const allowed = new Set((allowedText.match(NUMBER) ?? []).map(normaliseNumber));
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => (sentence.match(NUMBER) ?? []).every((n) => allowed.has(normaliseNumber(n))));
  return kept.map((s) => s.trim()).filter(Boolean).join(" ");
}

function str(value: unknown, allowed: string): string {
  return typeof value === "string" ? stripUnknownNumbers(value.trim(), allowed) : "";
}

function list(value: unknown, allowed: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => str(item, allowed)).filter(Boolean).slice(0, MAX_ITEMS);
}

export function parseNarrative(text: string, allowedText: string): Narrative {
  const data = extractJson(text) as Record<string, any> | null;
  if (!data || typeof data !== "object") invalid();
  const pillars = Object.fromEntries(
    PILLAR_KEYS.map((key) => [key, { position: list(data.pillars?.[key]?.position, allowedText) }]),
  ) as Narrative["pillars"];
  return {
    executiveSummary: { position: list(data.executiveSummary?.position, allowedText) },
    kpiNotes: {
      visibility: str(data.kpiNotes?.visibility, allowedText),
      rank: str(data.kpiNotes?.rank, allowedText),
      citations: str(data.kpiNotes?.citations, allowedText),
      shareOfVoice: str(data.kpiNotes?.shareOfVoice, allowedText),
    },
    competitorSummary: str(data.competitorSummary, allowedText),
    pillars,
    targetNotes: str(data.targetNotes, allowedText),
  };
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
