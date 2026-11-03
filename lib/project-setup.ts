import type { BrandImportRow } from "./brand-registry";

/** Category used when a project is created without typed categories or a workbook. */
export const DEFAULT_CATEGORY = "General";

export function parseCategoryList(text: string): string[] {
  return [...new Set(text.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean))];
}

/** Typed categories first, then the workbook's Categories sheet, then a single default category. */
export function resolveProjectCategories(typed: string[], workbookCategories: string[]): string[] {
  if (typed.length) return typed;
  if (workbookCategories.length) return workbookCategories;
  return [DEFAULT_CATEGORY];
}

/** Registry rows that put the tracked brand in every category, used when no workbook is uploaded. */
export function trackedBrandRows(categories: string[], brandName: string, website: string): BrandImportRow[] {
  return categories.map((category) => ({
    category, brand: brandName, aliases: [], website, otherWebsites: [], role: "tracked_brand", notes: "Tracked brand",
  }));
}
