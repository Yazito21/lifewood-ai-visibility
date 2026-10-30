export type SuggestionMode = "discovery" | "brand";

/** Case-, punctuation- and whitespace-insensitive form used to compare prompts. */
export function normalisePrompt(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Brand name, aliases and domains; a domain also matches without its TLD ("lifewood.com" → "lifewood"). */
function brandNeedles(brandTerms: string[]): string[] {
  const needles = brandTerms.flatMap((term) => {
    const bare = term.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
    const withoutTld = bare.includes(".") ? bare.split(".")[0] : bare;
    return [term, bare, withoutTld];
  });
  return [...new Set(needles.map(normalisePrompt).filter((needle) => needle.length >= 3))];
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
    if (needles.some((needle) => ` ${key} `.includes(` ${needle} `))) continue;
    seen.add(key);
    kept.push(candidate);
    if (kept.length >= opts.limit) break;
  }
  return kept;
}
