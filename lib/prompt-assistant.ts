export const PROMPT_LIMIT = 50;

export type SuggestionMode = "discovery" | "brand";

export type BrandProfile = {
  summary: string;
  offerings: string[];
  audiences: string[];
  markets: string[];
  differentiators: string[];
};

export type Suggestion = { id: string; prompt: string; category: string; language: string; mode: SuggestionMode; selected: boolean };

export function remainingSlots(existingCount: number): number {
  return Math.max(0, PROMPT_LIMIT - existingCount);
}

const messages: Record<string, string> = {
  AI_CREDIT_EXHAUSTED: "AI credit has run out. Top up OpenRouter or ask an admin.",
  AI_NOT_CONFIGURED: "The AI assistant isn't set up yet. An admin needs to add the OpenRouter key.",
};

/** User-facing text for a failed assistant call: known codes, then auth status, then the server's own message. */
export function assistantErrorMessage(code: string | undefined, message?: string, status?: number): string {
  if (code && messages[code]) return messages[code];
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You don't have permission to use the AI assistant on this project.";
  return message?.trim() || "The AI didn't respond. Try again.";
}

function normalise(text: string) {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Incoming prompts that are not already on screen (or repeated within the batch). */
export function notShown(incoming: string[], shown: string[]): string[] {
  const seen = new Set(shown.map(normalise));
  return incoming.filter((prompt) => {
    const key = normalise(prompt);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
