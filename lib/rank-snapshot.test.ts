import test from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert/strict";
import { chartSeries, latestSnapshots, rankDisplay, type DailyMetric } from "./rank-snapshot.ts";

const verified = (topic: string, metric_date: string, visibility_score: number, visibility_rank: number, population: number): DailyMetric => ({
  metric_date, topic, visibility_score, visibility_rank, rank_population_count: population, rank_population_status: "verified",
});

// Dr D latest reporting date (2026-10-26), as stored after the canonical backfill.
const drD: DailyMetric[] = [
  verified("Skin", "2026-10-25", 11.8, 1, 100), verified("Skin", "2026-10-26", 11.8, 1, 100),
  verified("Mind", "2026-10-25", 51.5, 1, 100), verified("Mind", "2026-10-26", 51.5, 1, 100),
  verified("Longevity", "2026-10-25", 9.1, 2, 100), verified("Longevity", "2026-10-26", 9.1, 2, 100),
  verified("Overall", "2026-10-25", 24, 2, 248), verified("Overall", "2026-10-26", 24, 2, 248),
];
const topics = ["Overall", "Skin", "Mind", "Longevity"];

test("Dr D cards show the canonical ranks and populations for the latest date", () => {
  const snapshots = latestSnapshots(drD, topics);
  strictEqual(rankDisplay(snapshots.get("Overall")).text, "2/248");
  strictEqual(rankDisplay(snapshots.get("Skin")).text, "1/100");
  strictEqual(rankDisplay(snapshots.get("Mind")).text, "1/100");
  strictEqual(rankDisplay(snapshots.get("Longevity")).text, "2/100");
});

test("card rank equals the last point of the rank chart for every topic and date", () => {
  for (const topic of topics) {
    const dates = [...new Set(drD.filter((row) => row.topic === topic).map((row) => row.metric_date))].sort();
    for (const date of dates) {
      const upTo = drD.filter((row) => row.metric_date <= date);
      const card = rankDisplay(latestSnapshots(upTo, topics).get(topic));
      const series = chartSeries(upTo, topic, "visibility_rank");
      strictEqual(card.rank, series[series.length - 1].value, topic + " " + date);
    }
  }
});

test("Lifewood-style rows with a larger population format consistently", () => {
  const rows = [verified("Overall", "2026-10-24", 26, 20, 332), verified("AEO", "2026-10-24", 7.5, 17, 100)];
  const snapshots = latestSnapshots(rows, ["Overall", "AEO"]);
  strictEqual(rankDisplay(snapshots.get("Overall")).text, "20/332");
  strictEqual(rankDisplay(snapshots.get("AEO")).text, "17/100");
});

test("an unverified row still shows its rank (matching the chart) with a note, never a fabricated denominator", () => {
  const row: DailyMetric = { metric_date: "2026-10-20", topic: "Skin", visibility_score: 3, visibility_rank: 14, rank_population_count: null, rank_population_status: "unverified" };
  const display = rankDisplay(row);
  strictEqual(display.text, "14");
  strictEqual(display.population, null);
  strictEqual(display.note, "Historical population unverified");
  strictEqual(chartSeries([row], "Skin", "visibility_rank")[0].value, 14);
});

test("no eligible competitors yields an explicit unavailable state, not rank 1/1", () => {
  const row: DailyMetric = { metric_date: "2026-10-26", topic: "Skin", visibility_score: 10, visibility_rank: null, rank_population_count: 0, rank_population_status: "no_eligible_observations" };
  const display = rankDisplay(row);
  strictEqual(display.text, "N/A");
  strictEqual(display.note, "No eligible competitor observations");
});

test("start-of-period baseline is the first recorded day, not yesterday", () => {
  const rows = [
    verified("Skin", "2026-10-16", 5, 9, 100),
    verified("Skin", "2026-10-20", 8, 6, 100),
    verified("Skin", "2026-10-28", 11, 5, 100),
    verified("Skin", "2026-10-29", 11.8, 4, 100),
  ];
  const snap = latestSnapshots(rows, ["Skin"]).get("Skin")!;
  strictEqual(snap.startRank, 9);
  strictEqual(snap.startRankDate, "2026-10-16");
  strictEqual(snap.rankChange, 5);
  strictEqual(snap.startScore, 5);
  strictEqual(Math.round((snap.scoreChange ?? 0) * 10) / 10, 6.8);
});

test("a falling rank and score give negative changes", () => {
  const rows = [verified("Skin", "2026-10-16", 20, 1, 100), verified("Skin", "2026-10-29", 12, 4, 100)];
  const snap = latestSnapshots(rows, ["Skin"]).get("Skin")!;
  strictEqual(snap.rankChange, -3);
  strictEqual(snap.scoreChange, -8);
});

test("a single recorded day has no baseline to compare with", () => {
  const snap = latestSnapshots([verified("Skin", "2026-10-29", 12, 4, 100)], ["Skin"]).get("Skin")!;
  strictEqual(snap.startRank, null); strictEqual(snap.rankChange, null);
  strictEqual(snap.startScore, null); strictEqual(snap.scoreChange, null);
});

test("an unverified-population baseline is still used and flagged", () => {
  const rows = [
    { metric_date: "2026-10-16", topic: "AEO", visibility_score: 6, visibility_rank: 20, rank_population_count: null, rank_population_status: "unverified" } as DailyMetric,
    verified("AEO", "2026-10-29", 7.5, 17, 100),
  ];
  const snap = latestSnapshots(rows, ["AEO"]).get("AEO")!;
  strictEqual(snap.startRank, 20); strictEqual(snap.startRankVerified, false); strictEqual(snap.rankChange, 3);
});

test("rank direction: lower number is better and series are date ordered", () => {
  const rows = [verified("Skin", "2026-10-26", 11.8, 1, 100), verified("Skin", "2026-10-23", 2.9, 4, 100)];
  deepStrictEqual(chartSeries(rows, "Skin", "visibility_rank").map((p) => p.label), ["2026-10-23", "2026-10-26"]);
});
