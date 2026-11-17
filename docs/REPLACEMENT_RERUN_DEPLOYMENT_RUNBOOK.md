# Replacement Rerun Deployment and Rollback Runbook

**Status: Prepared, not executed.**  
**Target Supabase project:** `jhauufmrxpsbfrahgclv`  
**Repository:** `Yazito21/lifewood-ai-visibility`  
**Feature branch:** `feat/replace-rerun-data`

This runbook is a controlled release plan only. It does not authorize Production deployment, migration application, historical deletion, or a live rerun.

## 1. Release scope

The replacement-rerun branch changes three deployment surfaces:

1. **Supabase database:** twelve migrations listed below.
2. **Supabase Edge Function:** `visibility-tracking`, including candidate staging, atomic promotion, and the emergency pause gate.
3. **Vercel application:** `app/platform/[projectId]/dashboard/page.tsx`, which runs and resumes category batches and retains failed candidate IDs.

The branch also adds CI fixtures/tests and this operational documentation. No other Edge Function is in the intended release scope. The local-only `[db.migrations]` configuration used by CI must not be treated as a hosted database setting; see [Supabase CLI configuration](https://supabase.com/docs/guides/local-development/cli/config).

## 2. Preconditions and release blockers

Do not begin a hosted release until all of the following are satisfied:

- A separate non-Production Supabase project is available for a hosted integration rehearsal. Current CI uses a disposable local database only.
- Handler-level mocked lifecycle tests now cover provider failures, entity-extraction failures/retries, raw response persistence, all six candidate staging tables, promotion success/failure, and fail-closed promotion responses. The tests are committed but must pass in CI before any hosted rehearsal.
- The tracked-brand registry bootstrap write side effect has been removed. Tracking now performs a read-only registry/category-assignment preflight and fails before provider calls or run creation when configuration is incomplete.
- A fresh read-only audit confirms the live schema, triggers, foreign keys, grants, RLS, function definitions, and migration history still match the assumptions in the implementation. The read-only Production preflight has confirmed the migration history, required columns, and tracking-run foreign keys; the remaining trigger/grant/RLS/function-definition checks are still release preconditions.
- A current database backup/PITR recovery point is confirmed, and the operational owner is available during the release.
- The exact intended pending migration set has been reconciled against the hosted migration history. **Do not run a generic `supabase db push` until this comparison proves it will apply only the reviewed changes.** Stop if any unrelated migration is pending or the migration history is inconsistent.
- The user explicitly approves the exact Production migrations, Edge Function deployment, and Vercel Production deployment. Historical deletion requires separate explicit approval.

Current product constraints remain: promotion is category-scoped; Dashboard batches process categories sequentially; one configured tracking location is supported by the current project schema; full-batch atomicity and multi-location candidate runs are not implemented.

## 3. Migration set and order

Apply only this reviewed sequence, after the live migration-history reconciliation:

1. `20261113090000_add_tracking_run_candidate_staging.sql`
2. `20261113100000_finalize_metrics_per_tracking_location.sql`
3. `20261113110000_add_tracking_run_replacement_audit.sql`
4. `20261113120000_add_tracking_run_candidate_validation.sql`
5. `20261113130000_add_tracking_run_replacement_preview.sql`
6. `20261113140000_use_location_scoped_presence_helpers.sql`
7. `20261113150000_promote_tracking_run_candidate_atomically.sql`
8. `20261117110000_coordinate_competitor_recompute_with_tracking_replacements.sql`
9. `20261117120000_harden_candidate_raw_response_scope_validation.sql`
10. `20261117130000_validate_staged_brand_project_ownership.sql`
11. `20261117140000_rebuild_cross_provider_overall_after_replacement.sql`
12. `20261117150000_exclude_superseded_runs_from_leaderboard_lookup.sql`

These migrations add candidate staging/audit structures and define or update the validation, preview, promotion, metric-finalization, recompute-coordination, cross-provider Overall rebuild, and active published-run lookup functions. The final migration ensures superseded runs are not selected as current leaderboard data. They do not authorize historical cleanup. Do not manually delete rows from canonical metric tables or legacy competitor tables as part of this release.

## 4. Controlled rollout sequence

### A. Preflight

1. Confirm the release commit SHA and that both CI jobs are green.
2. Confirm the Production backup/PITR recovery point.
3. Re-run the live read-only schema/function/trigger/FK audit and compare the remote migration history.
4. Confirm the exact migration list to be applied. Stop on any unexpected pending migration.
5. Confirm the dedicated sandbox project is isolated from Production data and credentials.

### B. Deploy the Edge Function in paused mode

1. Set the Edge Function secret `TRACKING_REPLACEMENT_PAUSED=true` on the target environment.
2. Deploy only `visibility-tracking` from the reviewed release commit.
3. Verify a request returns HTTP 503 with `TRACKING_TEMPORARILY_PAUSED` before it creates a run or writes to the database.
4. Do not unpause yet.

The pause gate is checked before authentication, database access, run creation, provider calls, candidate staging, or promotion.

### C. Apply database migrations

1. Apply the twelve migrations in the order above using the approved migration procedure.
2. Re-run the schema/security contract and read-only function-definition checks against the hosted target.
3. Confirm the promotion RPC, candidate staging RPC, validation/preview RPCs, and advisory-lock coordination are present with the intended service-role-only grants.
4. Stop if any migration or post-migration contract check fails. Keep tracking paused.

### D. Deploy the Vercel application

1. Create/review the pull request from `feat/replace-rerun-data`.
2. Verify the Vercel Preview deployment against the same release commit.
3. Confirm the Dashboard category batch, failed-candidate retention, and resume flow behave as expected against the sandbox.
4. Promote the same reviewed commit to Vercel Production only after explicit approval and successful sandbox rehearsal.

### E. Sandbox acceptance

With the Edge Function still paused in Production, run the full end-to-end rehearsal in the separate sandbox project. Validate first publication, exact-scope replacement, forced failure, retry, promotion failure, and preservation of unrelated categories/locations/projects. Only after these pass should a separate Production release approval be considered.

### F. Production enablement

Production tracking must remain paused until the separate sandbox rehearsal, live schema verification, and release approvals are complete. Then remove the pause secret (or set it to `false`) and perform the approved controlled first run/replacement with before-and-after counts captured.

Do not use Dr D Signature Clinic, MDLand, or unrelated client projects as test targets.

## 5. Rollback and emergency response

The rollback strategy is **pause first, repair forward**. Do not assume that redeploying the old Edge Function is safe: the previous direct-write implementation can bypass the candidate-staging and atomic-promotion protocol.

If a deployment or smoke test fails:

1. Set `TRACKING_REPLACEMENT_PAUSED=true` immediately and verify the 503 response.
2. Stop new tracking batches and do not retry promotion manually.
3. If the Vercel application is faulty, roll Vercel back to the previous known-good application deployment. This does not roll back Supabase.
4. Keep the additive database structures and audit records in place. Do not drop candidate/audit tables or reverse functions destructively after they may have received data.
5. Diagnose from Edge Function logs, run-stage journals, candidate rows, and replacement audit records. Prefer a forward-fix migration/function release while tracking remains paused.
6. If canonical data is found to be incorrect, stop and prepare a separate, scope-specific recovery plan from the verified backup/PITR point. Do not delete or restore historical Production rows without explicit approval.
7. Re-enable tracking only after the corrected code and database contracts pass the required checks.

The pause secret is an operational stop control, not a substitute for database backups or a tested recovery plan.

## 6. Current Production preflight findings

The connected Production project is active and healthy. Its applied migration history currently ends at the November 12, 2026 report-template migrations; none of the twelve replacement migrations above has been applied. The replacement audit table is therefore not present in Production. The live read-only inventory also confirmed legacy source-run dependencies and failed/partial unpublished attempts that must be retained unless a separate historical cleanup plan is approved.

No Production schema or data changes were made during the preflight. This section is informational and does not authorize a release.

## 7. Explicitly out of scope

- No Production migration, Edge Function deployment, or Vercel Production deployment has been performed by preparing this runbook.
- No Production historical predecessor inventory or deletion has been performed.
- No legacy `competitors`, `direct_competitors`, or `direct_competitor_observations` data is to be deleted.
- No Dr D Signature Clinic, MDLand, or unrelated project is to be modified or used for testing.
