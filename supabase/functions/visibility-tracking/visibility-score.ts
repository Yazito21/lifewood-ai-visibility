export type VisibilityResponse = {
  response_id?: unknown;
  prompt_id?: unknown;
  tracking_location?: unknown;
  provider?: unknown;
  status?: unknown;
  response_text?: unknown;
};

export type EntityVisibility = {
  mention_count: number;
  presence_count: number;
  response_count: number;
  visibility_score: number;
};

/**
 * Canonical response-presence visibility calculation.
 * Numerator: distinct valid response records with at least one entity match.
 * Denominator: distinct valid response records in this exact caller-provided scope.
 * Multiple aliases/mentions in one response contribute only one presence.
 */
export function calculateEntityVisibility(
  rows: VisibilityResponse[],
  matchCount: (response: VisibilityResponse) => number,
): EntityVisibility {
  const unique = new Map<string, VisibilityResponse>();
  for (const row of rows) {
    if (row.status !== "completed" || !String(row.response_text ?? "").trim()) continue;
    const key = row.response_id != null
      ? String(row.response_id)
      : [row.provider ?? "", row.tracking_location ?? "", row.prompt_id ?? ""].map(String).join("\u0000");
    if (!key || key === "\u0000\u0000") continue;
    if (!unique.has(key)) unique.set(key, row);
  }

  let mention_count = 0;
  let presence_count = 0;
  for (const response of unique.values()) {
    const count = Math.max(0, Number(matchCount(response)) || 0);
    mention_count += count;
    if (count > 0) presence_count += 1;
  }
  const response_count = unique.size;
  return {
    mention_count,
    presence_count,
    response_count,
    visibility_score: response_count
      ? Math.round((presence_count / response_count) * 1000) / 10
      : 0,
  };
}
