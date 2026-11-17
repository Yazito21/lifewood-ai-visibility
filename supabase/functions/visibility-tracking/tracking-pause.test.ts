import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isTrackingPaused } from "./tracking-pause.ts";

Deno.test("tracking pause is enabled only by an explicit true value", () => {
  for (const value of ["true", " TRUE ", "True"]) {
    assertEquals(isTrackingPaused(value), true);
  }
  for (const value of [null, undefined, "", "false", "1", "yes", " true-ish "]) {
    assertEquals(isTrackingPaused(value), false);
  }
});
