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

export type RankSnapshot = DailyMetric & {
  /** Rank and score on the first recorded day of the period the metrics were loaded for. */
  startRank: number | null;
  startRankDate: string | null;
  startRankVerified: boolean;
  startScore: number | null;
  startScoreDate: string | null;
  /** Positions gained since the start of the period: positive means the rank number fell (moved up). */
  rankChange: number | null;
  /** Latest score minus start-of-period score, in percentage points. */
  scoreChange: number | null;
};

export type RankDisplay = {
  /** Integer rank, 1 is best; null when no rank exists for the scope. */
  rank: number | null;
  /** Rank population from the same row; null when unverified or unavailable. */
  population: number | null;
  /** "7/100", "7" (population unverified) or "N/A". */
  text: string;
  /** Short explanation shown beneath the rank when it is not fully verified. */
  note: string | null;
};

function hasVerifiedPopulation(row: DailyMetric) {
  return row.rank_population_status === "verified" && (row.rank_population_count ?? 0) > 0;
}

/**
 * Latest row per topic, compared with that topic's first recorded day in `metrics`.
 * Callers pass the rows for the selected reporting period, so the baseline is the start of the period
 * (or the first tracked day after it when earlier days have no data). The grain is unique, so a date tie cannot occur.
 */
export function latestSnapshots(metrics: DailyMetric[], topics: string[]): Map<string, RankSnapshot> {
  const byTopic = new Map<string, DailyMetric[]>();
  for (const row of metrics) byTopic.set(row.topic, [...(byTopic.get(row.topic) ?? []), row]);
  const snapshots = new Map<string, RankSnapshot>();
  for (const topic of topics) {
    const rows = (byTopic.get(topic) ?? []).slice().sort((a, b) => a.metric_date.localeCompare(b.metric_date));
    const current = rows[rows.length - 1];
    if (!current) continue;
    const earlier = rows.filter((row) => row.metric_date !== current.metric_date);
    const startRankRow = earlier.find((row) => row.visibility_rank !== null);
    const startScoreRow = earlier.find((row) => row.visibility_score !== null);
    const startRank = startRankRow?.visibility_rank ?? null;
    const startScore = startScoreRow?.visibility_score ?? null;
    snapshots.set(topic, {
      ...current,
      startRank,
      startRankDate: startRankRow?.metric_date ?? null,
      startRankVerified: startRankRow ? hasVerifiedPopulation(startRankRow) : false,
      startScore,
      startScoreDate: startScoreRow?.metric_date ?? null,
      rankChange: current.visibility_rank !== null && startRank !== null ? startRank - current.visibility_rank : null,
      scoreChange: current.visibility_score !== null && startScore !== null ? current.visibility_score - startScore : null,
    });
  }
  return snapshots;
}

/** The same row the chart plots for that date, formatted for a card. */
export function rankDisplay(row: DailyMetric | undefined): RankDisplay {
  if (!row) return { rank: null, population: null, text: "N/A", note: null };
  if (row.visibility_rank === null) {
    return {
      rank: null,
      population: null,
      text: "N/A",
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
