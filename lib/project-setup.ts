import type { BrandImportRow } from "./brand-registry";

/** Topic used when a project is created without typed topics or a workbook. */
export const DEFAULT_TOPIC = "General";

export function parseTopicList(text: string): string[] {
  return [...new Set(text.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean))];
}

/** Typed topics first, then the workbook's Topics sheet, then a single default topic. */
export function resolveProjectTopics(typed: string[], workbookTopics: string[]): string[] {
  if (typed.length) return typed;
  if (workbookTopics.length) return workbookTopics;
  return [DEFAULT_TOPIC];
}

/** Registry rows that put the tracked brand in every topic, used when no workbook is uploaded. */
export function trackedBrandRows(topics: string[], brandName: string, website: string): BrandImportRow[] {
  return topics.map((topic) => ({
    topic, brand: brandName, aliases: [], website, otherWebsites: [], role: "tracked_brand", notes: "Tracked brand",
  }));
}
