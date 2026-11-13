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


## 2026-11-13: Edge Function candidate-write refactor committed

Commits:
- `4eb3f2b88769f9f17370ad8405228d0f7fb4ecb5` — route derived candidate writes to staging and defer publication.
- `0699abef6c22e62235c0ff36e49fb77e0eae2ba1` — calculate candidate citation metrics from candidate occurrence rows.

### Changes

- Added a chunked `stageCandidateRows` helper that sends derived rows to `stage_tracking_candidate_rows` in batches of 250.
- Replaced direct canonical writes for citations, citation occurrences, response brand evidence, third-party mentions, category brand observations and visibility daily metrics with candidate staging.
- Removed pre-publication category cleanup of canonical competitors, observations, citations, occurrences and daily metrics.
- Removed the category rerun cleanup of evidence and third-party mentions.
- Candidate run completion no longer sets `published_at`; publication is deferred to the future promotion RPC.
- Citation counts for candidate metrics are calculated from the current candidate's in-memory occurrence rows, rather than querying canonical occurrence rows belonging to a prior published run.
- Added deterministic candidate keys based on stable row identity fields.

### Important incomplete items / blockers

- The Edge Function still persists raw `ai_responses` under the candidate run ID. This is intentional and necessary for evidence foreign keys, but promotion and failure-retention policies still need to be completed.
- The promotion RPC has not yet been implemented. Therefore successful runs remain completed but unpublished and do not update the canonical dashboard.
- The full-run path needs separate treatment for its Overall aggregate and per-category publication semantics.
- The staging RPC and migration have not been applied to Production. The modified Edge Function must not be deployed to Production before the migration and promotion RPC are deployed together.
- No Deno typecheck, integration test or live candidate run has been executed yet.

### Updated checklist

- [x] Add candidate staging schema and service-role RPC.
- [x] Add Edge Function staging helper and route the derived write paths to staging.
- [x] Remove premature category cleanup operations.
- [x] Defer publication until a promotion transaction exists.
- [x] Compute candidate citation counts without reading the old canonical dataset.
- [ ] Implement atomic promotion RPC for category-scoped and full-run workflows.
- [ ] Ensure promotion deletes/replaces all scoped canonical derived rows and handles foreign-key dependencies.
- [ ] Ensure canonical rank finalisation and Overall aggregation occur within the intended transaction boundary.
- [ ] Update client/run-history logic for completed-but-unpublished candidate runs.
- [ ] Add automated tests and run Deno checks.
- [ ] Read-only historical rerun inventory.
- [ ] Historical predecessor deletion (separate explicit approval).

No Production migration, Edge Function deployment, or historical data deletion has occurred.


## 2026-11-13: per-location metric finalisation migration committed

Commit: `8e15d5e8531c68cb36a4b6a29163599092624590`

Added `supabase/migrations/20261113100000_finalize_metrics_per_tracking_location.sql`.

### Audit finding addressed

The existing `run_tracked_presence(run_id, category)` helper counted completed responses across every tracking location in a run. Meanwhile, `finalize_run_metrics` iterated daily rows by location but passed the run-level `tracking_location` into canonical ranking. For projects tracking multiple locations, this could pool response counts and calculate ranks against the wrong location.

### Migration changes

- Adds a three-argument `run_tracked_presence(run_id, category, tracking_location)` helper.
- Filters completed AI responses to the exact tracking location before calculating response and tracked-brand presence counts.
- Replaces `finalize_run_metrics` so each daily row uses its own `tracking_location` for presence counts and `canonical_scoped_rank`.
- Keeps the existing two-argument helper available for other existing callers.
- Restricts direct execution of the new helper and finalisation function to service role; the existing publication trigger continues to invoke finalisation through its security-definer context.

### Status

This is a required foundation for safe multi-location promotion, not the promotion transaction itself. The migration is committed to the feature branch only and has not been applied to Production.

- [x] Correct per-location presence and response counts during finalisation.
- [x] Rank each location against its own canonical population.
- [ ] Promotion RPC to replace canonical rows transactionally.
- [ ] Invoke Overall aggregation for every affected location.
- [ ] Delete superseded raw and derived run data after successful promotion.
- [ ] Test single-location and multi-location replacement, rollback and scope isolation.


## 2026-11-13: staging RPC input validation hardened

Commit: `2746864fb1c21e494ed2957a5a13864a0f1cf0aa`

- Removed a duplicate row-count diagnostics statement.
- Explicitly rejects SQL NULL as well as non-array JSON input.
- No schema or production data was changed by this code-only correction.

## 2026-11-13: promotion transaction dependency audit

The promotion design must preserve replacement lineage outside `tracking_runs` if superseded run rows are physically deleted. The current `supersedes_run_id` foreign key uses `ON DELETE SET NULL`, so deleting the predecessor removes the direct lineage pointer. The existing publication trigger also discovers the previous run at publication time; if the predecessor is deleted first, that trigger cannot discover it.

The promotion transaction therefore needs a durable replacement audit record (with predecessor and replacement UUIDs stored as values, not foreign keys to deletable run rows), and must write it before deleting predecessor runs.

Additional dependency handling required inside the same transaction:

- Reassign any `tracking_run_daily_claims` rows to the replacement run before deleting the old run, otherwise the claim cascades away.
- Update `tracking_batch_categories.tracking_run_id` to the replacement run where applicable; its current FK would otherwise be set to NULL.
- Check and rewire or reject any `tracking_runs.source_run_id` references before deletion; this FK has no ON DELETE action and can block deletion.
- Allow `tracking_run_stages` to cascade with the deleted predecessor only after preserving any required operational audit in the replacement audit record.
- Explicitly delete old `third_party_mentions` rows because their response FK uses SET NULL rather than CASCADE.
- Delete/replace canonical date-grain rows by the candidate's actual set of locations, not merely the run row's first `tracking_location`.

The current Edge Function uses the current Malaysia-local date for `metric_date` and stores the first configured tracking location on the run row, while candidate rows contain their individual locations. Promotion must derive the complete scope from staged rows and raw responses. Historical-date replacement needs a separate explicit date input/contract; it must not infer historical target dates from `started_at`.

### Scope of next promotion implementation

The promotion RPC must reject unsupported or ambiguous candidate shapes rather than partially publish them. Category-scoped and full-run candidates must be handled explicitly, with complete location/category coverage validation. No predecessor deletion is allowed unless every replacement scope has a validated candidate.

### Status

- [x] Staging input validation hardened.
- [x] Foreign-key and lineage deletion dependencies identified.
- [ ] Durable replacement audit table.
- [ ] Transactional promotion RPC.
- [ ] Candidate coverage validation for category and full runs.
- [ ] Daily-claim and batch reference reassignment.
- [ ] Tests for rollback and all affected foreign keys.


## 2026-11-13: durable replacement audit table committed

Commit: `3a5d5a56c066aed6e6fb1f767f9639ad51f68032`

Added `supabase/migrations/20261113110000_add_tracking_run_replacement_audit.sql`.

### Schema

The new `tracking_run_replacements` table records:
- Project, Malaysia-local metric date, category, provider and tracking location.
- Replacement run ID and replaced predecessor run ID.
- JSON snapshots of both run records.
- Per-table deleted-row counts.
- Replacement timestamp and actor.

Run IDs are intentionally stored without foreign keys to `tracking_runs`. This is necessary because the required physical deletion of predecessor run records must not erase their replacement lineage. Project and actor references retain normal referential integrity.

RLS is enabled, with direct access revoked from public, anon and authenticated and granted to service role only.

### Scope and limitations

This is the durable audit foundation only. The table is not yet populated by a promotion function. No predecessor records are deleted by this migration. It does not enable production rerun replacement.

### Updated checklist

- [x] Candidate staging schema and RPC.
- [x] Candidate write path in Edge Function.
- [x] Per-location metric finalisation.
- [x] Durable replacement audit schema.
- [ ] Promotion RPC with exact-scope locking and complete candidate validation.
- [ ] Atomic canonical replacement and metrics publication.
- [ ] Daily claim and batch reference reassignment.
- [ ] Safe predecessor raw-response and run deletion.
- [ ] Overall aggregation refresh per affected location.
- [ ] Tests for success, failure, rollback, retries, full-run and category-run cases.
- [ ] Read-only historical rerun inventory.
- [ ] Historical predecessor deletion after separate explicit approval.

No Production migration or Edge Function deployment has occurred.


## 2026-11-13: read-only candidate validation gate committed

Commits:
- `a57637313fb2053797eac8684319a39778f6f9b2` — add validation RPC.
- `a62686019fdfdeeda6099356521c23c2f530db71` — correct raw/completed response count validation.

Added `supabase/migrations/20261113120000_add_tracking_run_candidate_validation.sql`.

### Validation behaviour

The service-role-only `validate_tracking_run_candidate(p_run_id)` function is read-only. It returns a JSON report with `valid`, candidate identity, project, run kind, category scope, metric date(s), categories, locations, response counts, metric row counts and a list of validation errors.

It rejects candidates that:
- Are missing, not completed, already published, or are an Overall aggregate.
- Have a raw response count different from `tracking_runs.total_prompts`.
- Have completed response count different from `tracking_runs.completed_prompts`.
- Contain any non-completed response in an otherwise completed candidate.
- Have no tracking locations.
- Do not have exactly one metric date.
- Do not have the complete expected category/location coverage in provider-specific staged visibility rows.
- Contain staged rows with project, location or metric-date scope mismatches.

Raw response totals and completed response totals are validated separately because failed prompts can also have persisted diagnostic response rows.

RLS and execute grants restrict the function to service role. It does not publish runs, write canonical tables, delete predecessors, or mutate candidate data.

### Important scope restriction

The current Edge Function uses the current Malaysia-local date and has not yet implemented a historical target-date input. The validator therefore verifies that a candidate has exactly one metric date, but it does not assume that a candidate is a historical rerun. Historical date support remains a separate implementation requirement.

### Updated checklist

- [x] Candidate staging schema and RPC.
- [x] Edge Function candidate staging writes.
- [x] Per-location metric finalisation.
- [x] Durable replacement audit table.
- [x] Read-only candidate validation gate.
- [ ] Transactional promotion RPC.
- [ ] Candidate validation invocation before promotion.
- [ ] Atomic canonical row replacement and predecessor cleanup.
- [ ] Daily-claim and batch reference reassignment.
- [ ] Overall aggregation refresh for every affected location.
- [ ] Full-run and category-run semantics.
- [ ] Integration tests including rollback and multi-location cases.
- [ ] Read-only historical rerun inventory.
- [ ] Historical predecessor deletion after separate explicit approval.

No Production migration or Edge Function deployment has occurred.
