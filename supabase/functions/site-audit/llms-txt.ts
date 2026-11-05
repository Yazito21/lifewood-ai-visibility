import type { LlmsTxtResult } from "./types.ts";

const MISSING: LlmsTxtResult = { exists: false, hasTitle: false, hasSummary: false, sectionCount: 0, linkCount: 0, valid: false };

/** Presence and structure of /llms.txt (# title, > summary, ## sections with markdown links). */
export function analyzeLlmsTxt(text: string | null): LlmsTxtResult {
  if (text === null || !text.trim() || /^\s*<(!doctype|html)/i.test(text)) return { ...MISSING };
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const hasTitle = lines.some((line) => /^#\s+\S/.test(line));
  const hasSummary = lines.some((line) => /^>\s*\S/.test(line));
  const sectionCount = lines.filter((line) => /^##\s+\S/.test(line)).length;
  const linkCount = (text.match(/\[[^\]]+\]\([^)\s]+\)/g) ?? []).length;
  return { exists: true, hasTitle, hasSummary, sectionCount, linkCount, valid: hasTitle && hasSummary && sectionCount > 0 && linkCount > 0 };
}
