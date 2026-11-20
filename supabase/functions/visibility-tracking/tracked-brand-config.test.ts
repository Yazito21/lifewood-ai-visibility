import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateTrackedBrandConfiguration } from "./tracked-brand-config.ts";

const tracked = {
  id: "brand-lifewood",
  canonical_name: "Lifewood",
  normalized_key: "lifewood",
  is_tracked_brand: true,
  is_active: true,
};
const competitor = {
  id: "brand-competitor",
  canonical_name: "Competitor",
  normalized_key: "competitor",
  is_tracked_brand: false,
  is_active: true,
};

Deno.test("accepts a complete tracked-brand configuration without mutation", () => {
  const assignments = [
    { category: "AI Data", brand_id: tracked.id, role: "tracked_brand" },
    { category: "AI Data", brand_id: competitor.id, role: "competitor" },
  ];
  const before = structuredClone({ assignments, directory: [tracked, competitor] });

  const result = validateTrackedBrandConfiguration(
    "Lifewood", ["AI Data"], assignments, [tracked, competitor],
  );

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.fixedTrackedId, tracked.id);
    assertEquals(result.validAssignments.length, 2);
    assertEquals(result.directoryById.get(competitor.id)?.canonical_name, "Competitor");
  }
  assertEquals({ assignments, directory: [tracked, competitor] }, before);
});

Deno.test("fails closed when tracked brand registry row is absent", () => {
  const result = validateTrackedBrandConfiguration(
    "Lifewood",
    ["AI Data"],
    [{ category: "AI Data", brand_id: "missing", role: "tracked_brand" }],
    [],
  );
  assertEquals(result, {
    ok: false,
    code: "TRACKED_BRAND_REGISTRY_INCOMPLETE",
    missingCategories: ["AI Data"],
  });
});

Deno.test("fails closed when category assignment is missing or points to an inactive/unavailable row", () => {
  const result = validateTrackedBrandConfiguration(
    "Lifewood",
    ["AI Data", "AEO/GEO"],
    [{ category: "AI Data", brand_id: tracked.id, role: "tracked_brand" }],
    [tracked],
  );
  assertEquals(result, {
    ok: false,
    code: "TRACKED_BRAND_ASSIGNMENT_INCOMPLETE",
    missingCategories: ["AEO/GEO"],
  });
});

Deno.test("recognizes a tracked row by normalized brand key for legacy registry records", () => {
  const legacyTracked = { ...tracked, is_tracked_brand: false };
  const result = validateTrackedBrandConfiguration(
    "Lifewood & Co.",
    ["AI Data"],
    [{ category: "AI Data", brand_id: legacyTracked.id, role: "tracked_brand" }],
    [{ ...legacyTracked, normalized_key: "lifewoodandco" }],
  );
  assertEquals(result.ok, true);
});

Deno.test("does not treat a competitor assignment as the tracked-brand assignment", () => {
  const result = validateTrackedBrandConfiguration(
    "Lifewood",
    ["AI Data"],
    [{ category: "AI Data", brand_id: tracked.id, role: "competitor" }],
    [tracked],
  );
  assertEquals(result, {
    ok: false,
    code: "TRACKED_BRAND_ASSIGNMENT_INCOMPLETE",
    missingCategories: ["AI Data"],
  });
});
