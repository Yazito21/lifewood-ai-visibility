export const PROMPT_LIMIT = 100;

export type SuggestionMode = "discovery" | "brand";

export type BrandProfile = {
  summary: string;
  offerings: string[];
  audiences: string[];
  markets: string[];
  differentiators: string[];
};

export type Suggestion = { id: string; prompt: string; topic: string; language: string; mode: SuggestionMode; selected: boolean };

export function remainingSlots(existingCount: number): number {
  return Math.max(0, PROMPT_LIMIT - existingCount);
}

const messages: Record<string, string> = {
  AI_CREDIT_EXHAUSTED: "AI credit has run out. Top up OpenRouter or ask an admin.",
  AI_NOT_CONFIGURED: "The AI assistant isn't set up yet. An admin needs to add the OpenRouter key.",
};

export function assistantErrorMessage(code: string | undefined): string {
  return (code && messages[code]) || "The AI didn't respond. Try again.";
}
