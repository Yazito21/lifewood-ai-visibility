import test from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { DEFAULT_TOPIC, parseTopicList, resolveProjectTopics, trackedBrandRows } from "./project-setup.ts";

test("parseTopicList splits commas, semicolons and new lines and removes duplicates", () => {
  deepStrictEqual(parseTopicList("Data Collection, AIGC;\nAIGC\n  "), ["Data Collection", "AIGC"]);
  deepStrictEqual(parseTopicList("   "), []);
});

test("typed topics win", () => {
  deepStrictEqual(resolveProjectTopics(["EHR"], ["Billing"]), ["EHR"]);
});

test("blank topics fall back to the workbook's topics", () => {
  deepStrictEqual(resolveProjectTopics([], ["Billing", "EHR"]), ["Billing", "EHR"]);
});

test("blank topics without a workbook use one default topic", () => {
  strictEqual(DEFAULT_TOPIC, "General");
  deepStrictEqual(resolveProjectTopics([], []), ["General"]);
});

test("trackedBrandRows adds the tracked brand once per topic", () => {
  deepStrictEqual(trackedBrandRows(["General", "EHR"], "MDLand", "https://mdland.com/"), [
    { topic: "General", brand: "MDLand", aliases: [], website: "https://mdland.com/", otherWebsites: [], role: "tracked_brand", notes: "Tracked brand" },
    { topic: "EHR", brand: "MDLand", aliases: [], website: "https://mdland.com/", otherWebsites: [], role: "tracked_brand", notes: "Tracked brand" },
  ]);
});
