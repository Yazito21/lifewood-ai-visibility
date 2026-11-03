import test from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { DEFAULT_CATEGORY, parseCategoryList, resolveProjectCategories, trackedBrandRows } from "./project-setup.ts";

test("parseCategoryList splits commas, semicolons and new lines and removes duplicates", () => {
  deepStrictEqual(parseCategoryList("Data Collection, AIGC;\nAIGC\n  "), ["Data Collection", "AIGC"]);
  deepStrictEqual(parseCategoryList("   "), []);
});

test("typed categories win", () => {
  deepStrictEqual(resolveProjectCategories(["EHR"], ["Billing"]), ["EHR"]);
});

test("blank categories fall back to the workbook's categories", () => {
  deepStrictEqual(resolveProjectCategories([], ["Billing", "EHR"]), ["Billing", "EHR"]);
});

test("blank categories without a workbook use one default category", () => {
  strictEqual(DEFAULT_CATEGORY, "General");
  deepStrictEqual(resolveProjectCategories([], []), ["General"]);
});

test("trackedBrandRows adds the tracked brand once per category", () => {
  deepStrictEqual(trackedBrandRows(["General", "EHR"], "MDLand", "https://mdland.com/"), [
    { category: "General", brand: "MDLand", aliases: [], website: "https://mdland.com/", otherWebsites: [], role: "tracked_brand", notes: "Tracked brand" },
    { category: "EHR", brand: "MDLand", aliases: [], website: "https://mdland.com/", otherWebsites: [], role: "tracked_brand", notes: "Tracked brand" },
  ]);
});
