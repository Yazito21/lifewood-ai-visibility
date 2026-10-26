export type ScopedRankResult = { rank: number | null; populationCount: number };

/**
 * Competition ranking over a tracked brand and only eligible competitor scores.
 * Missing/non-finite competitor scores are excluded; zero is a valid observed score.
 * Strictly-greater comparison means ties share the same rank (1, 1, 3).
 */
export function rankAgainstEligiblePopulation(
  trackedScore: number | null,
  competitorScores: Array<number | null | undefined>,
): ScopedRankResult {
  if (trackedScore === null || !Number.isFinite(trackedScore)) {
    return { rank: null, populationCount: 0 };
  }
  const eligibleScores = competitorScores.filter(
    (score): score is number => typeof score === "number" && Number.isFinite(score),
  );
  return {
    rank: 1 + eligibleScores.filter((score) => score > trackedScore).length,
    populationCount: eligibleScores.length + 1,
  };
}
