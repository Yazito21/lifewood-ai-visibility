import test from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import JSZip from "jszip";
import { buildDashboardReport, buildLeaderboardReport, meanByDate } from "./page-reports.ts";
import { valueAxisBounds } from "./excel-report.ts";

const ctx = { projectName: "Test Brand", locationLabel: "Malaysia", period: "Last 2 Days", start: "2026-10-28", end: "2026-10-29" };
const metric = (topic: string, metric_date: string, visibility_score: number, visibility_rank: number) => ({ metric_date, topic, visibility_score, visibility_rank, rank_population_count: 10, rank_population_status: "verified" });

test("score axis is fixed at 5.0 majors with 2.5 minors", () => {
  const b = valueAxisBounds("score", [3.2, 11.9]);
  strictEqual(b.min, 0); strictEqual(b.max, 15); strictEqual(b.major, 5); strictEqual(b.minor, 2.5);
  strictEqual(valueAxisBounds("score", [0.4]).max, 5);
});

test("rank axis uses whole ranks with 1 at the top", () => {
  const b = valueAxisBounds("rank", [1.5, 7.2]);
  strictEqual(b.min, 1); strictEqual(b.max, 8); strictEqual(b.major, 1);
});

test("rank axis is labelled every 5 ranks once it passes 25", () => {
  const b = valueAxisBounds("rank", [3, 52]);
  strictEqual(b.major, 5); strictEqual(b.max, 55); strictEqual(b.min, 0);
  strictEqual(valueAxisBounds("rank", [3, 25]).major, 1);
});

test("meanByDate averages per date and skips nulls", () => {
  const out = meanByDate([{ metric_date: "2026-10-28", v: 2 as number | null }, { metric_date: "2026-10-28", v: 4 }, { metric_date: "2026-10-29", v: null }], "v");
  strictEqual(out.length, 1); strictEqual(out[0].value, 3);
});

test("dashboard workbook holds only the supplied period data and one chart per series", async () => {
  const metrics = [metric("Overall", "2026-10-28", 5, 4), metric("Overall", "2026-10-29", 7, 3), metric("Skin", "2026-10-28", 2, 6), metric("Skin", "2026-10-29", 3, 5)];
  const { buffer, filename } = await buildDashboardReport({ ...ctx, topics: ["Overall", "Skin"], metrics, citationsByTopic: { Skin: [{ url: "https://a.test/x", page_name: "A", brand_name: "B", frequency: 3 }] } });
  ok(filename.endsWith("2026-10-28-to-2026-10-29.xlsx"));
  const zip = await JSZip.loadAsync(buffer);
  const charts = Object.keys(zip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
  strictEqual(charts.length, 4);
  const xml = await zip.file(charts[0])!.async("string");
  ok(xml.includes('<c:majorUnit val="5"/>') && xml.includes('<c:minorUnit val="2.5"/>'));
  const all = (await Promise.all(Object.keys(zip.files).filter((n) => n.endsWith(".xml")).map((n) => zip.file(n)!.async("string")))).join("");
  ok(!all.includes(String.fromCharCode(0x2014)), "no em dashes in the workbook");
});

test("leaderboard workbook lists every entry with rank change", async () => {
  const rows = [1, 2, 3].map((rank) => ({ rank, brand_name: "Brand " + rank, website: null, isTracked: rank === 2, visibility_score: 50 - rank, citations: 10 * rank, previousRank: rank === 3 ? null : rank + 1, previousVisibility: 40, previousCitations: 5 }));
  const { buffer } = await buildLeaderboardReport({ ...ctx, topicLabel: "All topics", engineLabels: ["ChatGPT"], totalEngines: 5, previousRange: { start: "2026-10-26", end: "2026-10-27" }, rows });
  const zip = await JSZip.loadAsync(buffer);
  const strings = await zip.file("xl/sharedStrings.xml")!.async("string");
  ok(strings.includes("Brand 3") && strings.includes("(your brand)") && strings.includes("New"));
});

test("dashboard cards compare the latest day with the first day of the period", async () => {
  const metrics = [metric("Skin", "2026-10-16", 5, 9), metric("Skin", "2026-10-27", 8, 6), metric("Skin", "2026-10-29", 11.8, 4)];
  const { buffer } = await buildDashboardReport({ ...ctx, period: "Last 14 Days", start: "2026-10-16", end: "2026-10-29", topics: ["Skin"], metrics, citationsByTopic: {} });
  const zip = await JSZip.loadAsync(buffer);
  const strings = await zip.file("xl/sharedStrings.xml")!.async("string");
  ok(strings.includes("2026-10-16") && strings.includes("Previous Score Date") && strings.includes("Score Change"));
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  ok(sheet.includes("<v>5</v>"), "rank change of 5 positions (9 to 4)");
  ok(sheet.includes("<v>6.8</v>"), "score change of 6.8 points (5.0 to 11.8)");
});
