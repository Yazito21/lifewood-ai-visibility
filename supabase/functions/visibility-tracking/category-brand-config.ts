export type CategoryBrandAssignment = {
  category: string;
  brand_id: string;
  role: string;
};

export type CategoryBrandValidation =
  | { ok: true }
  | {
    ok: false;
    invalidCategories: Array<{ category: string; tracked: number; competitors: number }>;
  };

/**
 * Every category must have one tracked brand and at most 99 distinct competitors.
 * Competitor sets are category-specific and do not need to be padded to 99.
 */
export function validateCategoryBrandAssignments(
  categories: string[],
  assignments: CategoryBrandAssignment[],
): CategoryBrandValidation {
  const invalidCategories = categories.map((category) => {
    const rows = assignments.filter((row) => row.category === category);
    const tracked = new Set(rows.filter((row) => row.role === "tracked_brand").map((row) => row.brand_id)).size;
    const competitors = new Set(rows.filter((row) => row.role === "competitor").map((row) => row.brand_id)).size;
    return { category, tracked, competitors };
  }).filter((row) => row.tracked !== 1 || row.competitors > 99);

  return invalidCategories.length ? { ok: false, invalidCategories } : { ok: true };
}
