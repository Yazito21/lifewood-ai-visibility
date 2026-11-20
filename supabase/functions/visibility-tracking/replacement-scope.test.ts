import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateReplacementLocationScope } from "./replacement-scope.ts";

Deno.test("accepts one configured tracking location", () => {
  assertEquals(validateReplacementLocationScope(["MY"]), { ok: true, location: "MY" });
});

Deno.test("deduplicates repeated location values before validating", () => {
  assertEquals(validateReplacementLocationScope(["MY", "MY"]), { ok: true, location: "MY" });
});

Deno.test("rejects empty or multi-location replacement scopes", () => {
  assertEquals(validateReplacementLocationScope([]), {
    ok: false,
    code: "REPLACEMENT_REQUIRES_SINGLE_TRACKING_LOCATION",
    locations: [],
  });
  assertEquals(validateReplacementLocationScope(["MY", "SG"]), {
    ok: false,
    code: "REPLACEMENT_REQUIRES_SINGLE_TRACKING_LOCATION",
    locations: ["MY", "SG"],
  });
});
