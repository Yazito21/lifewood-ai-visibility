# Replacement-Based Tracking Reruns

**Status:** Implementation plan and production safety checklist  
**Date:** 2026-11-13  
**Repository:** `Yazito21/lifewood-ai-visibility`  
**Supabase project:** `jhauufmrxpsbfrahgclv`

## Objective

A successful rerun must replace the previous dataset for the same project, Malaysia calendar date, category, provider, and tracking location. It must not leave the previous run's raw responses, processed evidence, citation records, competitor observations, daily aggregates, or run-history record in the application database.

A failed or incomplete rerun must not disturb the currently published dataset.

## Existing behaviour found during the audit

The deployed `visibility-tracking` Edge Function currently:

1. Creates a new `tracking_runs` row and records the previous published run in `supersedes_run_id`.
2. Retains the previous run's raw responses and run-history record.
3. For Superadmin category reruns, deletes same-day category aggregate rows during the `category_cleanup` stage, before the new run has completed extraction and metric generation. The code itself labels this a recovery risk.
4. Writes the new response/evidence/citation/competitor/metric data and then publishes the new run.
5. The database publication guard marks the prior run superseded and finalizes the new run's metrics. It does not physically remove the prior run.

This does not meet the requested replace-only behaviour and creates a window where the old aggregates have already been removed before the new run is known to be successful.

## Target workflow

1. Start a new category run and write all its raw responses and derived data under a new run ID. Do not modify the existing published dataset.
2. Validate provider responses, prompt coverage, response analysis, evidence extraction, citation extraction, competitor observations, and required metric rows.
3. If validation fails, mark the candidate run failed/partial and leave the previous published dataset and statistics unchanged.
4. If validation passes, invoke one database-side replacement operation.
5. In one transaction, the database operation locks the replacement scope, validates the candidate run, removes all previous run records and their dependent raw/derived records for that exact project/date/category/provider/location, promotes the new run to canonical/published, finalizes rank/count snapshots, and refreshes the Overall aggregates using the latest category datasets.
6. Commit only if every step succeeds. A failure rolls the transaction back, preserving the previous dataset.
7. Run history and UI queries expose only the surviving current run for that scope. The old run is not retained as a superseded record.

## Codebase changes planned

### `supabase/functions/visibility-tracking/index.ts`

- Remove the early destructive category cleanup stage.
- Keep candidate run writes isolated by `run_id` while it is processing.
- Do not set `published_at` directly from the Edge Function.
- Require complete success and all expected extraction/analysis results before replacement.
- Call a database RPC as the final commit step; return success only after the RPC succeeds.
- If candidate processing fails, keep the old canonical dataset unchanged. Failed candidate data may be cleaned separately as non-published staging data according to retention policy.
- Rebuild category and Overall statistics from the candidate run plus the latest valid category runs, without changing unrelated categories or projects.

### Run history and UI

- Update run-history queries/components so deleted predecessor runs are not expected or presented as superseded history.
- Keep the currently active run and current processing status visible.
- Ensure the UI does not imply that historical superseded runs are retained.
- Review exports and analytics queries for assumptions that multiple published/superseded runs remain available.

### Tests

Add automated tests for:
- Successful category rerun replaces the previous run and all dependent data.
- Failed, partial, or invalid rerun leaves the previous data and dashboard metrics unchanged.
- A Skin replacement does not modify Mind or Longevity.
- Replacement is scoped by project, provider, date, category, and location.
- Multiple reruns on different historical dates leave only the latest run per date/scope.
- Overall aggregation uses the replacement category data and the latest surviving runs from other categories.
- Transaction rollback restores the prior dataset if any replacement or metric-finalization step fails.
- No predecessor run remains in `tracking_runs`, `ai_responses`, or dependent evidence/citation tables after a successful replacement.

## Database changes planned

### New migration and database RPC

Add a transaction-safe RPC (service-role only) to perform the canonical replacement. It will:

- Lock the candidate run and its exact replacement scope to prevent concurrent reruns from racing.
- Verify the candidate run is complete, belongs to the expected project/category/provider/location/date, and has the required response/derived-data coverage.
- Identify prior runs in the same scope/date, including legacy superseded runs linked by `supersedes_run_id` and `superseded_at`.
- Delete predecessor run rows, relying on verified foreign-key cascades for run-owned response/evidence/stage data and explicitly removing date/category aggregate tables that are not run-owned.
- Preserve the new candidate's response/evidence/citation records and category aggregates.
- Publish/finalize the candidate only after predecessor cleanup is ready in the same transaction.
- Refresh Overall metrics from the surviving latest category runs for the same project/date/provider/location.
- Restrict execution to the service role and revoke public/anon/authenticated execution.

The migration will be designed only after inspecting all foreign keys, triggers, and current RPC definitions. No `CASCADE` assumptions will be made without verifying the constraints.

### Historical cleanup

Prepare a separate, read-only inventory for every project/category/provider/location/date with rerun lineage. It will list exact predecessor run IDs and row counts across all affected tables. The destructive cleanup will:

- Delete only predecessor runs proven to be replaced by a later successful run in the same exact scope.
- Preserve the latest successful run for every scope/date.
- Preserve Dr D Signature Clinic, MDLand, and all unrelated project data.
- Preserve current prompt/configuration/brand registry/client report data.
- Recompute or verify published daily and Overall statistics after cleanup.
- Be executed only after the inventory and exact deletion scope are presented and approved.

## Deployment and verification sequence

1. Commit this plan and create the implementation branch.
2. Complete schema/FK/function and frontend query audit.
3. Implement the Edge Function and database RPC changes.
4. Add SQL contract tests and Edge Function tests.
5. Run lint, type checks, tests, and a production-like local database simulation.
6. Apply the additive migration to the intended database and verify function privileges/integrity checks.
7. Deploy the Edge Function and frontend code.
8. Run a controlled test rerun and verify rollback behaviour.
9. Generate the historical predecessor inventory and obtain approval before deleting any production historical data.
10. Execute approved cleanup and verify all project/category/date scopes.

## Safety boundaries

- No production historical data is deleted as part of writing this plan.
- No Dr D or MDLand records are to be deleted or modified by the cleanup.
- A rerun must never delete the current dataset before the replacement candidate passes validation.
- The replacement and publication must be atomic from the dashboard's perspective.
- External backups, platform logs, and infrastructure audit trails are outside the application database and cannot be erased by this workflow.


## 2026-11-13 implementation audit addendum

### Critical finding: candidate writes are not isolated

A second pass through the Edge Function and live uniqueness constraints found that removing the early cleanup alone is not safe. The Edge Function currently writes candidate data into shared, date-grain tables before the run is marked completed:

- `category_brand_observations` upserts on project/brand/category/date/location/provider; the key does not include `run_id`.
- `visibility_daily` upserts on project/date/category/provider/location; the key does not include `run_id`.
- `citation_occurrences`, `response_brand_evidence`, and `third_party_mentions` are keyed to response IDs and are candidate-isolated only because each candidate gets new `ai_responses` IDs.
- The explicit `category_cleanup` block deletes published rows before candidate validation.
- The Edge Function marks the run completed and sets `published_at` itself; publication currently triggers metric finalisation and supersession.

The live database confirms the first two tables use date-grain uniqueness/primary keys that cannot hold both a published version and a candidate version simultaneously. Therefore, simply moving the cleanup later or removing it would still allow candidate upserts to overwrite published metrics.

### Revised implementation requirement

The safe implementation must use a two-phase data boundary:

1. **Candidate phase:** persist raw responses and all candidate-derived rows under the candidate run ID, without modifying any currently published date-grain rows.
2. **Publication transaction:** in one database transaction, lock the exact project/category/provider/location/MYT-date scope, validate the candidate, replace the current scope rows from candidate data, update publication lineage, finalise canonical ranks, refresh Overall, and only then commit.
3. **Rollback:** any failure in replacement, rank finalisation, or Overall refresh must roll back the complete publication transaction and leave the previous published dataset unchanged.

The current date-grain tables cannot support phase 1 without a staging boundary. The implementation must therefore add candidate staging storage (or equivalent run-versioned tables) and a transactional promotion RPC. The RPC must copy from staging into the live tables only after validation. The staging design must cover every derived table written by the Edge Function, not just `visibility_daily`.

### Current implementation status

- [x] Initial implementation plan committed.
- [x] Edge Function write-path and database uniqueness audit completed.
- [ ] Candidate staging schema and constraints.
- [ ] Transactional replacement/promotion RPC.
- [ ] Edge Function writes routed to candidate staging.
- [ ] Publication moved entirely to the promotion RPC.
- [ ] Automated tests for rollback, isolation, and replacement.
- [ ] Historical rerun inventory.
- [ ] Historical predecessor deletion (requires separate explicit approval).

No production data has been deleted or modified as part of this audit. No schema changes or Edge Function deployments have been applied.


## 2026-11-13: candidate staging foundation committed

Commit: `d2be5f1b853ebe0b0b87fbb9a8371863e621833e`

Added migration `supabase/migrations/20261113090000_add_tracking_run_candidate_staging.sql` to the feature branch.

### What it adds

- `tracking_run_candidate_rows`: run-scoped JSONB staging for derived rows.
- Allowed table keys are explicitly whitelisted: citations, citation occurrences, response evidence, third-party mentions, category observations, daily metrics, competitors and direct competitor observations.
- Unique run/table/row key makes retries idempotent.
- `stage_tracking_candidate_rows` RPC validates service-role access, run existence, writable run status and allowed table keys.
- RLS enabled; access revoked from public, anon and authenticated; service role only.
- Additive migration only. It does not alter or delete existing published data.

### Important limitation

This is the staging foundation, not the completed rerun implementation. The Edge Function has not yet been switched to write these candidate rows, and there is no promotion RPC yet. Do not apply this migration to Production or consider rerun replacement active until the Edge Function, promotion transaction, read-path changes and tests are complete.

### Updated checklist

- [x] Initial implementation plan and audit.
- [x] Additive candidate staging schema and staging RPC committed to feature branch.
- [ ] Route every derived Edge Function write to candidate staging.
- [ ] Remove all pre-publication cleanup of canonical rows.
- [ ] Add atomic promotion RPC with exact scope locking and rollback.
- [ ] Promote candidate rows into canonical tables and refresh category/Overall metrics.
- [ ] Update read paths and run history to expose only canonical published data.
- [ ] Automated and integration tests.
- [ ] Historical rerun inventory (read-only).
- [ ] Historical predecessor deletion (separate explicit approval).

No production migration, Edge Function deployment, or production data deletion has occurred.


## 2026-11-13: staging scope validation hardened

Commit: `a1866960f9a5fb4fd4dfeb33bca90f11ea48382a`

Updated the staging RPC to reject rows whose `project_id` differs from the candidate run's project, and (for category-scoped runs) reject rows whose category differs from the candidate run's category. The generated fallback row key is now calculated after removing the optional caller-supplied `_candidate_key`, so that metadata does not affect idempotency.

This is a defensive database boundary only. The Edge Function still writes derived data to canonical tables, so replacement behaviour is not active. No migration has been applied to Production.
