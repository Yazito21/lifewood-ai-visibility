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
  strictEqual(display.text, "—");
  strictEqual(display.note, "No eligible competitor observations");
});

test("previous rank only comes from an earlier comparable (verified) date", () => {
  const rows = [
    { ...verified("Skin", "2026-10-23", 2.9, 4, 100) },
    { metric_date: "2026-10-24", topic: "Skin", visibility_score: 11, visibility_rank: 9, rank_population_count: null, rank_population_status: "unverified" } as DailyMetric,
    verified("Skin", "2026-10-26", 11.8, 1, 100),
  ];
  strictEqual(latestSnapshots(rows, ["Skin"]).get("Skin")?.previousRank, 4);
});

test("rank direction: lower number is better and series are date ordered", () => {
  const rows = [verified("Skin", "2026-10-26", 11.8, 1, 100), verified("Skin", "2026-10-23", 2.9, 4, 100)];
  deepStrictEqual(chartSeries(rows, "Skin", "visibility_rank").map((p) => p.label), ["2026-10-23", "2026-10-26"]);
});
