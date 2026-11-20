export type CandidatePromotionAdmin = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    data: { status?: string } | null;
    error: { message: string } | null;
  }>;
};

export type CandidatePromotionResult =
  | { published: true; promotion: { status?: string } }
  | { published: false; skipped: true; reason: "candidate_not_complete" }
  | { published: false; skipped: false; reason: "promotion_not_confirmed"; message: string };

/**
 * The database promotion RPC is the only operation allowed to publish a
 * candidate. Incomplete candidates must never reach it.
 */
export async function promoteCompletedTrackingCandidate(
  admin: CandidatePromotionAdmin,
  runId: string,
  actorId: string,
  candidateStatus: string,
): Promise<CandidatePromotionResult> {
  if (candidateStatus !== "completed") {
    return { published: false, skipped: true, reason: "candidate_not_complete" };
  }

  const { data, error } = await admin.rpc("promote_tracking_run_candidate", {
    p_run_id: runId,
    p_actor_id: actorId,
  });

  if (error || data?.status !== "published") {
    return {
      published: false,
      skipped: false,
      reason: "promotion_not_confirmed",
      message: error?.message || "The promotion RPC did not confirm publication.",
    };
  }

  return { published: true, promotion: data };
}
