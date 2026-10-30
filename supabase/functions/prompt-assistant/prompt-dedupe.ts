export type SuggestionMode = "discovery" | "brand";

const MAX_EXCLUDE = 40;
const MAX_PROMPT_CHARS = 300;
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);

/** Case-, punctuation- and whitespace-insensitive form used to compare prompts. */
export function normalisePrompt(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** "data.lifewood.com" → "lifewood"; "shop.acme.co.uk" → "acme". */
function registrableLabel(domain: string): string {
  const labels = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/:\d+$/, "").split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  const secondLast = labels[labels.length - 2];
  const usesSecondLevel = labels.length >= 3 && SECOND_LEVEL.has(secondLast) && labels[labels.length - 1].length === 2;
  return usesSecondLevel ? labels[labels.length - 3] : secondLast;
}

/** Brand name, aliases and the registrable label of each domain, normalised. */
function brandNeedles(brandTerms: string[]): string[] {
  const needles = brandTerms.flatMap((term) => {
    const trimmed = term.trim();
    const isDomain = /^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed.replace(/^https?:\/\//i, ""));
    return isDomain ? [registrableLabel(trimmed)] : [trimmed];
  });
  return [...new Set(needles.map(normalisePrompt).filter((needle) => needle.length >= 2))];
}

const asciiWordChar = /[a-z0-9]/;

/** Substring match that ignores hits inside a longer Latin word but still matches next to CJK or Thai text. */
function mentions(text: string, needle: string): boolean {
  for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + 1)) {
    const before = text[index - 1] ?? "";
    const after = text[index + needle.length] ?? "";
    if (!asciiWordChar.test(before) && !asciiWordChar.test(after)) return true;
  }
  return false;
}

/** Prompts the panel is already showing, bounded so a client cannot inflate the model request. */
export function sanitizeExclude(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item && item.length <= MAX_PROMPT_CHARS)
    .slice(0, MAX_EXCLUDE);
}

/**
 * Keeps new, distinct suggestions. Discovery prompts that name the brand are dropped
 * because they would mention the brand almost every time and inflate the visibility score.
 */
export function filterSuggestions(
  candidates: string[],
  existing: string[],
  opts: { mode: SuggestionMode; brandTerms: string[]; limit: number },
): string[] {
  const seen = new Set(existing.map(normalisePrompt));
  const needles = opts.mode === "discovery" ? brandNeedles(opts.brandTerms) : [];
  const kept: string[] = [];
  for (const candidate of candidates) {
    const key = normalisePrompt(candidate);
    if (!key || seen.has(key)) continue;
    if (needles.some((needle) => mentions(key, needle))) continue;
    seen.add(key);
    kept.push(candidate);
    if (kept.length >= opts.limit) break;
  }
  return kept;
}
