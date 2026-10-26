// Dashboard rank cards and rank charts both derive from the same canonical daily
// metric rows (visibility_daily, one row per project/date/topic/engine/location).
// Rank and population are computed once in Postgres (canonical_scoped_rank); the UI
// never recomputes them, it only selects and formats.

export type DailyMetric = {
  metric_date: string;
  topic: string;
  visibility_score: number | null;
  visibility_rank: number | null;
  rank_population_count: number | null;
  rank_population_status: string;
};

export type RankSnapshot = DailyMetric & { previousRank: number | null };

export type RankDisplay = {
  /** Integer rank, 1 is best; null when no rank exists for the scope. */
  rank: number | null;
  /** Rank population from the same row; null when unverified or unavailable. */
  population: number | null;
  /** "7/100", "7" (population unverified) or "—". */
  text: string;
  /** Short explanation shown beneath the rank when it is not fully verified. */
  note: string | null;
};

function hasVerifiedPopulation(row: DailyMetric) {
  return row.rank_population_status === "verified" && (row.rank_population_count ?? 0) > 0;
}

/** Latest row per topic plus the previous comparable rank. Tie on date cannot occur: the grain is unique. */
export function latestSnapshots(metrics: DailyMetric[], topics: string[]): Map<string, RankSnapshot> {
  const byTopic = new Map<string, DailyMetric[]>();
  for (const row of metrics) byTopic.set(row.topic, [...(byTopic.get(row.topic) ?? []), row]);
  const snapshots = new Map<string, RankSnapshot>();
  for (const topic of topics) {
    const rows = (byTopic.get(topic) ?? []).slice().sort((a, b) => b.metric_date.localeCompare(a.metric_date));
    const current = rows[0];
    if (!current) continue;
    const previous = rows.find((row) => row.metric_date !== current.metric_date && row.visibility_rank !== null && hasVerifiedPopulation(row));
    snapshots.set(topic, { ...current, previousRank: previous?.visibility_rank ?? null });
  }
  return snapshots;
}

/** The same row the chart plots for that date, formatted for a card. */
export function rankDisplay(row: DailyMetric | undefined): RankDisplay {
  if (!row) return { rank: null, population: null, text: "—", note: null };
  if (row.visibility_rank === null) {
    return {
      rank: null,
      population: null,
      text: "—",
      note: row.rank_population_status === "no_eligible_observations" ? "No eligible competitor observations" : null,
    };
  }
  if (hasVerifiedPopulation(row)) {
    return { rank: row.visibility_rank, population: row.rank_population_count, text: row.visibility_rank + "/" + row.rank_population_count, note: null };
  }
  return { rank: row.visibility_rank, population: null, text: String(row.visibility_rank), note: "Historical population unverified" };
}

/** Chart series for one topic: exactly the stored rows, no interpolation, no recalculation. */
export function chartSeries(metrics: DailyMetric[], topic: string, key: "visibility_score" | "visibility_rank") {
  return metrics
    .filter((row) => row.topic === topic)
    .slice()
    .sort((a, b) => a.metric_date.localeCompare(b.metric_date))
    .map((row) => ({ label: row.metric_date, value: row[key] }));
}
