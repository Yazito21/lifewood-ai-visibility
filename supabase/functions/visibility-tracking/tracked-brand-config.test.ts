import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateCategoryBrandAssignments } from "./category-brand-config.ts";

Deno.test("accepts categories with different competitor counts", () => {
  const result = validateCategoryBrandAssignments(
    ["Institute of Science and Technology", "Lightweighting", "One-stop Service"],
    [
      { category: "Institute of Science and Technology", brand_id: "tracked", role: "tracked_brand" },
      ...Array.from({ length: 11 }, (_, index) => ({ category: "Institute of Science and Technology", brand_id: "ist-" + index, role: "competitor" })),
      { category: "Lightweighting", brand_id: "tracked", role: "tracked_brand" },
      ...Array.from({ length: 24 }, (_, index) => ({ category: "Lightweighting", brand_id: "lw-" + index, role: "competitor" })),
      { category: "One-stop Service", brand_id: "tracked", role: "tracked_brand" },
      ...Array.from({ length: 34 }, (_, index) => ({ category: "One-stop Service", brand_id: "one-" + index, role: "competitor" })),
    ],
  );
  assertEquals(result, { ok: true });
});

Deno.test("rejects missing or duplicate tracked brands and over-limit competitor sets", () => {
  assertEquals(validateCategoryBrandAssignments(
    ["Skin"],
    [{ category: "Skin", brand_id: "competitor", role: "competitor" }],
  ), { ok: false, invalidCategories: [{ category: "Skin", tracked: 0, competitors: 1 }] });

  assertEquals(validateCategoryBrandAssignments(
    ["Skin"],
    [
      { category: "Skin", brand_id: "tracked-a", role: "tracked_brand" },
      { category: "Skin", brand_id: "tracked-b", role: "tracked_brand" },
    ],
  ), { ok: false, invalidCategories: [{ category: "Skin", tracked: 2, competitors: 0 }] });

  assertEquals(validateCategoryBrandAssignments(
    ["Skin"],
    [
      { category: "Skin", brand_id: "tracked", role: "tracked_brand" },
      ...Array.from({ length: 100 }, (_, index) => ({ category: "Skin", brand_id: "competitor-" + index, role: "competitor" })),
    ],
  ), { ok: false, invalidCategories: [{ category: "Skin", tracked: 1, competitors: 100 }] });
});
