export type CandidateStagingAdmin = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ error: { message: string } | null }>;
};

const IDENTITY_FIELDS = [
  "id", "response_id", "entity_id", "brand_id", "competitor_id",
  "canonical_url", "url", "category", "tracking_location",
  "llm_provider", "provider", "metric_date", "prompt_id",
  "match_source", "matched_value", "source_type", "citation_index",
] as const;

export async function stageTrackingCandidateRows(
  admin: CandidateStagingAdmin,
  runId: string | null,
  tableKey: string,
  rows: Array<Record<string, unknown>>,
  batchSize = 250,
): Promise<void> {
  if (!runId || !rows.length) return;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("CANDIDATE_STAGING_INVALID_BATCH_SIZE");
  }

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize).map((row, index) => {
      const identityParts = IDENTITY_FIELDS.map((field) => row[field]);
      const hasIdentity = identityParts.some((value) =>
        value !== undefined && value !== null && String(value) !== ""
      );
      // JSON encoding avoids delimiter collisions. source_type and citation_index
      // distinguish otherwise-identical research mentions and citation occurrences.
      const identity = JSON.stringify(identityParts.map((value) => value ?? null));
      return { ...row, _candidate_key: hasIdentity ? identity : String(offset + index) };
    });

    const { error } = await admin.rpc("stage_tracking_candidate_rows", {
      p_run_id: runId,
      p_table_key: tableKey,
      p_rows: batch,
    });
    if (error) {
      throw new Error("CANDIDATE_STAGING_FAILED (" + tableKey + "): " + error.message);
    }
  }
}
