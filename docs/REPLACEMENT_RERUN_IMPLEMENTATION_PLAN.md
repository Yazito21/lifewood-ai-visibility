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


## 2026-11-13: candidate validation coverage correction

Commit: `713b0b9a2f91377d6bf556ba160f957add8007f5`

The Edge Function emits an additional `Overall` visibility row for full-run candidates, alongside the category rows. The validation gate is intended to validate category coverage; Overall is a derived aggregate and is recalculated after category publication. The coverage query now excludes `category = 'Overall'` when comparing staged visibility rows to the project's configured categories. It still requires provider-specific rows for every expected category/location pair.

This prevents a valid full-run candidate from being rejected simply because its staged payload also contains the Overall row.

No production migration has been applied and no production data has changed.


## 2026-11-13: read-only replacement preview RPC committed

Commits:
- `713b0b9a2f91377d6bf556ba160f957add8007f5` — exclude derived Overall rows from category coverage validation.
- `b00393828d108f894258851bdc61b8c24897c1c5` — document the validation correction.
- `d169c8a0427924de32ecec48461347a3260581f0` — add replacement preview RPC.

Added `supabase/migrations/20261113130000_add_tracking_run_replacement_preview.sql`.

### Preview behaviour

The service-role-only `preview_tracking_run_replacement(p_run_id)` function:
- Calls the read-only candidate validator first.
- Returns `ready_for_promotion=false` and the validation report when the candidate is invalid.
- Derives the candidate's exact category/location scope from staged provider-specific visibility rows, excluding derived Overall rows.
- Finds currently published canonical predecessor runs that occupy those exact date/category/provider/location scopes.
- Walks predecessor lineage through `supersedes_run_id` up to 50 levels.
- Reports dependent counts for raw responses, response evidence, citation occurrences, third-party mentions, category observations, daily metrics, daily claims, batch references and source-run references.
- Performs no inserts, updates or deletes.

### Safety / known limitations

- The preview is not the promotion transaction and does not authorize deletion.
- Date is read from the candidate's staged metric rows, not inferred from run start time.
- Legacy date-grain `citations`, `competitors` and direct competitor observations without run IDs are not yet included in predecessor row counts; their exact scope handling must be implemented in the promotion migration.
- The preview identifies active canonical predecessors and follows their recorded supersession lineage. Historical runs that have no canonical row and no lineage edge will require a separate read-only historical inventory.
- No Production migration has been applied.

### Updated checklist

- [x] Candidate staging schema and RPC.
- [x] Candidate write path in Edge Function.
- [x] Per-location metric finalisation.
- [x] Durable replacement audit table.
- [x] Read-only candidate validation.
- [x] Read-only replacement preview with predecessor dependency counts.
- [ ] Atomic promotion RPC.
- [ ] Canonical replacement for all staged and legacy date-grain tables.
- [ ] Reassignment of daily claims and batch references.
- [ ] Rebuild Overall metrics per location.
- [ ] Safe predecessor raw-response and run deletion.
- [ ] Automated tests for full-run, category-run, multi-location, rollback and retries.
- [ ] Historical rerun inventory and separate approval before cleanup.


### Replacement preview SQL correction

Commit: `7689e40c710d29c0b48fe4f728829e2e50226598`

Enabled PostgreSQL recursive-CTE syntax for the predecessor lineage walk. This is a syntax correction to the read-only preview function; it does not change database state.


## 2026-11-13: candidate ownership validation and preview coverage

Commits:
- `9a858e4e7b0586bfce06b26f1e6b24566c816199` — validate staged run and response ownership.
- `e4537e958bcb575244000cad49fbd407254073ee` — include legacy citation and competitor counts in preview.

### Candidate validator hardening

The read-only validator now rejects staged rows that:
- Carry a `run_id` different from the candidate.
- Reference an `ai_responses` row that does not belong to the candidate run (for citation occurrences, response evidence and third-party mentions).

This prevents candidate staging from accidentally retaining response-linked derived records from a predecessor.

### Replacement preview coverage

The preview now also reports counts of legacy date-grain `citations` and `competitors` for each predecessor's exact project/date/category/provider/location scope. These tables do not carry a run ID, so their replacement must be driven by the candidate's exact scope rather than predecessor run lineage.

### Newly confirmed replacement constraint

The current Edge Function reads prior canonical citations and merges their frequency into the new candidate citation rows during a full rerun. That behaviour is incompatible with a strict replacement contract, where the new successful run must represent its own result set and superseded date-level citation data must be removed. The preservation/merge block must be removed as part of the final Edge Function promotion integration; until then, the new candidate citation payload is not a pure replacement dataset.

No production migrations or Edge Function deployments have been applied. No production rows have been changed or deleted.


## 2026-11-13: predecessor citation carry-forward removed

Commit: `25c197dcd28c4c20eb5798e78a89ca6e476f89fe`

Removed the full-rerun block that read prior `citations` rows and merged their frequencies/URLs into the new candidate. Candidate citation rows now represent citations extracted from the candidate's own responses only. This aligns the candidate payload with replacement semantics: old date-grain citation rows will be removed at promotion, and only the replacement run's citation set should be inserted.

### Candidate staging audit

A source audit of the current Edge Function confirms that it stages these canonical derived tables:
- `citations`
- `citation_occurrences`
- `response_brand_evidence`
- `third_party_mentions`
- `category_brand_observations`
- `visibility_daily`

The Edge Function no longer directly inserts, updates or deletes the canonical derived tables. Raw `ai_responses` and run bookkeeping remain separate candidate-owned writes. The staging schema also allows `competitors` and `direct_competitor_observations`, but the current Edge Function does not stage either table. The promotion implementation must not assume these tables are populated by this candidate path; if these tables are still needed for UI/report consumers, their data must be rebuilt from supported candidate data or deliberately retained according to their independent source-of-truth rules.

### Remaining promotion design gates

Before the promotion RPC is considered safe:
- Determine whether the legacy `competitors` table is still read by any active application route/report.
- Determine whether `direct_competitor_observations` is managed by another workflow and must be retained rather than deleted.
- Define exact category-scoped versus full-run deletion rules for date-grain tables.
- Replace only citation rows for candidate categories and locations, not other categories or locations.
- Rebuild Overall after the category-level transaction using the established aggregation function.
- Ensure the publication trigger's supersession behaviour does not depend on predecessor rows after their deletion.
- Preserve daily claims, batch references and source-run references before deleting predecessor run records.

No Production migrations or Edge Function deployments have been applied. No production data has been changed or deleted.


## 2026-11-13: competitor table ownership audit

Commit: `de88267365cbb3bbca9ebd629e86985ca19c6ee9`

### Findings from the live schema and database routines

- `direct_competitor_observations` is actively consumed by `get_direct_competitor_metrics_for_period`, which joins it to `direct_competitors` and uses its per-date/location/provider presence and response counts to calculate direct-competitor ranks. These observations are not produced by the current visibility-tracking Edge Function candidate staging path.
- `direct_competitors` is the configured direct-competitor registry used by that metrics function. It is not run-owned data.
- `competitors` is a separate date-grain summary table. No public SQL view or database function referencing this table was found in the audit; application-level consumers have not yet been fully verified.
- Live row counts at audit time: `competitors` 6,076; `direct_competitor_observations` 2,688; `direct_competitors` 448.

### Replacement policy

- Preserve `direct_competitors` configuration rows unconditionally.
- Preserve `direct_competitor_observations` during visibility-tracking candidate promotion because they are produced/consumed by a separate direct-competitor workflow and are not candidate-staged. A future direct-competitor rerun must have its own candidate staging and replacement contract before these rows can be replaced.
- Treat `competitors` separately from the direct-competitor observation model. The current candidate path does not stage it; do not delete it until application-level usage and a replacement source are established.
- The read-only replacement preview now reports the direct-competitor observations and registry rows that overlap the candidate's exact scope, clearly labelled as retained rather than predecessor rows to delete.

### Updated checklist

- [x] Audit direct competitor observation consumers and source-of-truth boundary.
- [x] Preserve direct-competitor registry and observations outside visibility-tracking replacement.
- [x] Extend preview to report direct-competitor rows that will be retained.
- [ ] Verify application-level consumers of legacy `competitors` table.
- [ ] Decide a supported replacement source/retention policy for `competitors`.
- [ ] Implement atomic promotion for the six candidate-staged tables and the confirmed legacy citation/competitor scope.
- [ ] Rebuild Overall metrics and validate direct-competitor reporting remains intact.


## 2026-11-13: fresh live-schema and application-consumer audit

This checkpoint re-read the live Supabase schema and trigger/function definitions and inspected the feature-branch Edge Function plus the main application pages. This is a read-only audit; no live database writes or Production changes were made.

### Live database deployment status reconfirmed

The live Supabase project does not yet contain the feature-branch replacement objects:
- `tracking_run_candidate_rows` is absent.
- `tracking_run_replacements` is absent.
- `stage_tracking_candidate_rows` is absent.
- `validate_tracking_run_candidate` is absent.
- `preview_tracking_run_replacement` is absent.

The live database still has the original two-argument `run_tracked_presence(run_id, category)` and original `finalize_run_metrics` implementation. The live `tracking_runs_publication_guard` remains enabled for both INSERT and UPDATE. The new three-argument helper and location-aware finalizer exist only in the feature-branch migration.

This confirms that the new Edge Function must not be deployed until the staging migration and the complete promotion path are deployed in a compatible sequence.

### Fresh FK confirmation

The live FK audit reconfirmed:
- `citation_occurrences.response_id -> ai_responses.id`: ON DELETE CASCADE.
- `response_brand_evidence.response_id -> ai_responses.id`: ON DELETE CASCADE.
- `third_party_mentions.response_id -> ai_responses.id`: ON DELETE SET NULL, so predecessor mentions need explicit deletion.
- `tracking_run_stages.run_id -> tracking_runs.id`: ON DELETE CASCADE.
- `tracking_run_daily_claims.run_id -> tracking_runs.id`: ON DELETE CASCADE; claims must be reassigned or intentionally released before predecessor deletion.
- `tracking_batch_categories.tracking_run_id -> tracking_runs.id`: ON DELETE SET NULL; references must be reassigned where appropriate.
- `category_brand_observations.run_id -> tracking_runs.id` and `visibility_daily.run_id -> tracking_runs.id`: ON DELETE SET NULL.
- `tracking_runs.source_run_id -> tracking_runs.id`: NO ACTION; predecessor deletion must be blocked or references explicitly and correctly rewired.
- `tracking_runs.supersedes_run_id -> tracking_runs.id`: ON DELETE SET NULL; durable audit records must preserve predecessor lineage.

Only the publication guard triggers were found on `tracking_runs` in the targeted live trigger audit. They execute on INSERT and UPDATE.

### Critical issue: existing supersedes lineage can cross dates

The feature-branch Edge Function's `createTrackingRun()` currently looks up the latest published run for the same project/category/provider/first tracking location, but it does not constrain that lookup to the current Malaysia-local metric date. It stores that row in the candidate's `supersedes_run_id` before candidate validation/promotion.

Consequences:
- A candidate may point to a predecessor from an earlier date.
- The current replacement preview recursively follows `supersedes_run_id` lineage up to 50 levels without rechecking project/date/category/provider/location at each recursive step.
- Therefore, the preview can include older-date runs in a candidate's predecessor lineage. A future promotion RPC must not delete those rows merely because they are in this lineage chain.

Required correction:
1. Do not trust `supersedes_run_id` as sufficient evidence of same-date replacement.
2. Restrict predecessor discovery to canonical rows for the exact candidate project + metric date + category + provider + tracking location.
3. Restrict every recursive lineage step to the same exact scope, or stop using lineage traversal as a deletion selector.
4. Store only exact-scope predecessor IDs in `tracking_run_replacements`.
5. Set candidate supersession lineage inside the promotion transaction after the exact predecessor set has been established.
6. Add a regression test where the latest published run is from the previous date and verify it is not included or deleted.

This is a promotion safety blocker and must be fixed before any destructive RPC is implemented.

### Critical issue: per-location helper migration does not update all consumers

The feature-branch migration adds `run_tracked_presence(run_id, category, tracking_location)` and updates `finalize_run_metrics` to call it. The audit found other live SQL functions still calling the two-argument helper:
- `check_metric_integrity`
- `publish_cross_engine_metrics`
- `publish_engine_overall_metrics`
- `recompute_competitor_metrics`

The two-argument helper intentionally remains available for compatibility, but it aggregates responses across all locations. Therefore, those callers remain location-pooled unless updated. At minimum, the Overall aggregation and integrity/recompute paths must be reviewed and changed to pass the exact location. Do not assume the location-aware finalizer alone fixes multi-location reporting.

### Full-run versus category-run semantics need an explicit decision

The Edge Function creates category runs with `tracking_runs.category = selectedCategory`. A full run has `category = null` and the insert trigger assigns `run_kind = 'full'`. The candidate validator supports both shapes by expecting either the selected category or all configured project categories.

However, the existing `publish_engine_overall_metrics` function selects published `run_kind = 'category'` runs only. A full candidate's daily rows are associated with a `run_kind = 'full'` run, so the promotion design must not assume that simply publishing a full run will make it eligible for the existing category-based Overall aggregation. Existing full-run category slicing/backfill logic must be understood and the replacement transaction must define whether it creates category slices, uses a dedicated full-run aggregate path, or rejects full-run promotion until supported.

The safer first implementation may be category-scoped promotion only, provided the Edge Function/UI explicitly route supported replacements through that path and full-run candidates remain unpublished until a separately tested implementation is ready. Do not silently publish a full-run candidate with incomplete Overall semantics.

### Application-consumer audit: legacy `competitors` table

Inspected feature-branch dashboard, analytics, responses, citations, competitors, reports, samples, and report-data/leaderboard helpers.

Findings:
- The Competitors page uses the direct competitor registry and observation workflow, not the legacy `competitors` table.
- The leaderboard helper reads `direct_competitors`, `direct_competitor_observations`, `category_brand_observations`, and `visibility_daily`.
- Dashboard and Analytics primarily read `visibility_daily`; citation views use `get_cumulative_citations`.
- Responses page reads `ai_responses`.
- No direct `competitors` table reference was found in the inspected pages/helpers. This is useful evidence, but it is not a complete proof that no indirect RPC, report, admin, or other application route uses the legacy table. Keep the conservative no-delete policy until a repository-wide branch scan is complete.

### Updated next actions

1. [ ] Fix exact-date predecessor selection in the Edge Function and ensure promotion owns supersession lineage.
2. [ ] Restrict preview lineage recursion to the exact replacement scope; add cross-date regression coverage.
3. [ ] Update all relevant SQL consumers of `run_tracked_presence` to use the location-aware helper where location is known.
4. [ ] Decide and test category-only promotion first versus full-run promotion with category-slice semantics.
5. [ ] Complete repository-wide application scan for legacy `competitors` usage, including RPCs and report code.
6. [ ] Only then design and implement the atomic promotion RPC.

No Production migration, Edge Function deployment, candidate promotion, or historical deletion was performed in this checkpoint.


## 2026-11-13: exact-scope lineage safety fixes committed

Commits:
- `1234688d37ad8c560ae6c5e344271ddce57016cf` — defer predecessor lineage assignment in the Edge Function.
- `82510d61ad7f499957ad267d9bc22e964a36cd82` — constrain replacement-preview lineage recursion to the exact candidate scope/date.

### Edge Function change

The Edge Function no longer queries the latest published run and writes it into `supersedes_run_id` when creating a candidate. The old lookup did not constrain the Malaysia-local metric date, so a new candidate could have been linked to a prior day's run. Candidate creation now leaves predecessor lineage unset. The promotion transaction must discover exact-scope predecessors and assign lineage as part of the atomic publication process.

### Preview change

The recursive predecessor walk now additionally requires each parent run to match:
- Candidate project.
- Candidate provider.
- Candidate category and tracking location.
- Candidate metric date derived from the staged visibility rows, compared using Malaysia-local publication date.
- Completed and published status.

This prevents an old cross-date `supersedes_run_id` chain from being treated as a deletion list for the current date. The initial predecessor selection remains based on canonical visibility rows for the candidate's exact date/category/provider/location.

### Remaining caveat

The publication guard still operates on the run row's single `tracking_location`. If candidates can cover more than one location, the promotion transaction must explicitly manage all exact-location predecessor rows; it cannot rely solely on the trigger's single-location supersession lookup. The candidate validator supports multiple locations, so the promotion RPC must either fully support all locations or reject multi-location candidates until that behaviour is tested.

No Production migrations, Edge Function deployments, candidate promotions, or historical deletions were performed.


## 2026-11-13: sequential category batch and full-run audit

A further source review traced the dashboard's category batch orchestration and the legacy full-run lineage path. No live data was modified.

### Category batches create one candidate run per category

The Dashboard loops through configured categories sequentially and invokes `visibility-tracking` once per category. Each call creates a separate category-scoped `tracking_runs` candidate. The dashboard records each returned run ID in `tracking_batch_categories.tracking_run_id` and marks the batch category completed when the Edge Function returns `status = completed`.

Because publication has been deferred in the feature branch, these runs can be completed but unpublished. The Dashboard currently treats a completed Edge Function response as a completed category without itself invoking a promotion RPC. Therefore, the future integration must ensure that the Edge Function's final successful response is returned only after the promotion RPC has committed, or the dashboard must explicitly distinguish candidate completion from canonical publication.

### Batch continuation marker is not durable

The Edge Function currently uses `tracking_runs.error_message = 'CATEGORY_BATCH:' || run_id` as a marker to authorize the next category request. However, the final run-status update writes `error_message = null` when there are no run issues. This appears to clear the marker before the next category checks it. The next category's `parentRun` lookup then requires the marker to still be present.

This is a likely sequential-batch continuation defect and must be resolved before end-to-end batch testing. Do not overload `error_message` for batch membership/authorization. Prefer validating the previous run against durable `tracking_batches` / `tracking_batch_categories` membership, project, requester and in-progress batch status, or introduce a dedicated batch relationship field. Preserve normal error_message semantics for actual errors.

### Daily-claim and batch reference semantics

The first standard-admin category run claims the project's daily entitlement. Later category runs in the same batch are created using the previous category run ID as the continuation token. The daily claim therefore points to the first category run, while each category row points to its own run.

The promotion design must not blindly reassign every daily claim to every replacement run. It must preserve the batch's entitlement semantics and ensure deleting/replacing the first category run does not release the daily entitlement or make a completed batch resumable incorrectly. For `tracking_batch_categories`, replace only the exact category row's `tracking_run_id` with its new candidate run ID. Keep the batch-level row/status relationship intact.

### Full-run path remains separate

The Edge Function still supports a full Superadmin request with `tracking_runs.category = null` and `run_kind = 'full'`. The dashboard's standard category batch is a sequence of category runs. The existing Overall aggregation functions select `run_kind = 'category'` members, so full-run publication cannot be treated as equivalent to a batch of category runs without an explicit conversion/slicing strategy.

Recommended first safe release:
- Support category-scoped candidate promotion only.
- Ensure the standard dashboard category batch promotes each category candidate after validation, or promotes the whole batch atomically only after every category candidate is ready. Choose one model explicitly; do not allow partial batch state to masquerade as a fully replaced multi-category date.
- Keep full-run candidates completed-but-unpublished and reject promotion until their category-slice and Overall semantics are designed and tested.
- Superadmin single-category reruns can use the same category promotion contract.

### Next implementation design decision

Choose between:
1. **Per-category atomic promotion:** each category candidate replaces its own exact scope when successful; the batch can show partial progress if a later category fails. Overall is rebuilt after each category using the latest surviving category runs.
2. **Whole-batch atomic promotion:** all category candidates stage first; validate the entire batch; replace all configured categories and Overall in one transaction. If any category fails, none of the categories for that batch are replaced.

The user's original requirement states that a successful rerun replaces the exact category/date scope and that failed/incomplete candidates must not disturb existing published data. The whole-batch approach gives stronger all-categories consistency but requires the dashboard to stage all categories before promotion and a batch-level promotion RPC. The per-category approach matches the existing sequential UI more closely but can leave a date containing some newly replaced categories and some older categories if a later category fails. This choice must be confirmed against the intended product behaviour before implementing the final RPC.

No Production migrations, Edge Function deployments, candidate promotions, or historical deletions were performed.


## 2026-11-13: durable category-batch continuation and location-scoped SQL consumers

Commits:
- `00a566c967ebf9a5e01f6cf54025e55e11d84fde` — validate category continuation against durable batch records.
- `b664dbc2e904e2c19cfa7795ce5a9d85f77b64ad` — pass the batch ID from the Dashboard rather than the previous run ID.
- `4391c9b564ab4c73dd91f2e0a5844264dd0901ac` — reserve the daily entitlement for the first category in the durable batch.
- `dc92c7249222ec0c4f479ba4d6b489da61cd08fd` — update SQL consumers to call the location-aware presence helper.

### Durable category-batch continuation

The Dashboard now passes the actual `tracking_batches.id` on each category invocation. The Edge Function checks:
- Batch exists and belongs to the same project and requesting user.
- Batch remains in `running` state.
- Exactly one matching category row is currently `running`.
- Every earlier category ordinal is `completed` and has a saved `tracking_run_id`.

This removes the fragile dependency on `tracking_runs.error_message = 'CATEGORY_BATCH:...'`. The new category run is created only after these durable checks pass.

The first category in the batch (ordinal 0) obtains the daily entitlement using `claim_daily_tracking_run`, then updates that newly created run with the actual category and first tracking location. This is necessary because the legacy claim RPC creates a category-null run by default; without the scope update, the first category would be treated as a full run. Later categories create their own category-scoped run rows.

The Dashboard already stores each returned run ID on its corresponding `tracking_batch_categories` row, so the next invocation can validate the preceding category through durable state. No new batch schema was required.

### Location-scoped SQL helper consumers

Added migration `20261113140000_use_location_scoped_presence_helpers.sql`. It updates existing SQL function definitions to pass the location already available in their scope:
- `check_metric_integrity` passes `visibility_daily.tracking_location`.
- `publish_cross_engine_metrics` passes `p_location`.
- `publish_engine_overall_metrics` passes `p_location`.
- `recompute_competitor_metrics` passes the full-run row's `tracking_location`.

The new migration is additive to the earlier location-aware `finalize_run_metrics` migration. The two-argument helper remains for compatibility, but these known location-aware consumers no longer pool responses across locations.

### Important validation still outstanding

These changes are committed to the feature branch only. The SQL migration has not been applied to Supabase, and the Edge Function has not been deployed. The category-batch changes still require a controlled integration test against an isolated database, especially:
- First category creates a category-scoped `category` run while claiming the daily entitlement.
- Second and later categories are accepted only after the prior batch category is marked completed and linked to a completed run.
- Failed categories do not permit the next ordinal to start.
- Batch ownership and project scope are enforced.
- A failed first-category claim or scope update does not leave an incorrectly scoped candidate behind.

No Production migrations, Edge Function deployments, candidate promotions, or historical deletions were performed.


## 2026-11-13: atomic category promotion implementation drafted

Commits:
- `aca36d28ae24221cb2d5129bea7f30d648b2bfa0` — initial atomic category promotion RPC.
- `0313af91af3f51185beee854bc0df583c0f680e4` — strict staged-scope checks and per-run audit counts.
- `354301d3dde25c06a872bfd4b4ca95fa504fbfc2` — reject orphaned canonical metrics and include surviving/metadata-only predecessor lineage in audit.
- `010b5e97f59d31acba95ae4220caadc266dd0aea` — invalidate stale Overall snapshots if the category set is incomplete.
- `554950766d92f9cb294e8da92053e8448f49a830` — call the promotion RPC only after the candidate is completed.
- `a049b4e1f2f7b0a38a71a52cf722f92d3b4543c5` — retain candidate run ID in batch state when promotion returns an error.
- `e7beaa05a39f8f9fc825103fb9b1340f844debd6` — audit metadata-only predecessor lineage.
- `60d92802809b8bc6db14e40f6b3d681526b77ba6` — reject candidates whose raw responses span a different Malaysia-local date.
- `23b1beaca0db0983e3879b12ddccf95ebe3be94c` — safely resume a failed first-category batch without losing its daily entitlement.
- `e7e4324626eb472d0d825eafd16077422eaa3837` — restore failed batch status to running when resumed and preserve failed candidate IDs in batch rows.

### Promotion RPC behaviour

New migration `20261113150000_promote_tracking_run_candidate_atomically.sql` adds service-role-only `promote_tracking_run_candidate(p_run_id, p_actor_id)`.

It is deliberately limited to completed, unpublished, category-scoped `category` candidates. It:
1. Locks the candidate and serializes the project/date/category/provider scope.
2. Runs the candidate validator and read-only replacement preview.
3. Confirms every staged row matches the candidate project, date, category, provider and allowed locations.
4. Rejects orphaned/unpublished canonical metrics, full-run predecessors, shared-source category slices, cross-category predecessors and predecessor runs referenced by another source run.
5. Preserves daily entitlement by reassigning a same-date claim if it points to a predecessor being replaced.
6. Writes durable per-location predecessor snapshots and row counts to `tracking_run_replacements`.
7. Removes predecessor raw responses and exact-scope derived rows, while preserving direct competitor registry/observations and the legacy `competitors` table.
8. Promotes the staged citations, citation occurrences, brand evidence, third-party mentions, category observations and daily metrics using explicit column lists so generated IDs/defaults remain active.
9. Publishes the candidate only after all canonical rows are inserted; the publication trigger finalizes its per-location metrics.
10. Rebuilds the engine Overall aggregate independently for every affected location. If the category set is incomplete, it invalidates the stale Overall snapshot instead of leaving metrics that still include the replaced run.
11. Deletes the candidate staging rows after successful publication.

All operations run in the same PostgreSQL transaction. An exception rolls back the entire promotion, including predecessor deletion and canonical inserts. Full-run candidates and category slices backed by shared source runs are rejected rather than partially removed.

### Edge Function and batch integration

The Edge Function now calls the promotion RPC only after it has completed response processing and written a completed, unpublished candidate. If promotion fails, it returns `CANDIDATE_PROMOTION_FAILED` with the candidate run ID and leaves the existing published dataset untouched. The Dashboard records that candidate ID for diagnosis/retry.

The category batch workflow now uses durable `tracking_batches` and `tracking_batch_categories` rows for continuation. It passes the actual batch ID, verifies ownership and prior category completion, and no longer relies on the `CATEGORY_BATCH:` error-message marker. The first category's daily-claim-created run is updated to the correct category and tracking location so it becomes a category run rather than a category-null full run. A failed batch can be resumed by restoring its batch status to running. If the first category already published but the client did not receive the success response, the Edge Function recognises the existing published claim and avoids rerunning it.

### New validation guard

The candidate validator now rejects a candidate if any raw response's `captured_at` Malaysia-local date differs from the staged metric date. This prevents a long run crossing midnight from publishing mixed-date responses under one metric date.

### Important test/deployment gate

The promotion migration and the Edge Function call are committed to the feature branch but have **not** been deployed. No Production data has been changed or deleted.

The live Supabase project inventory queried during this checkpoint returned only Dr D Signature Clinic and MDLand project records; it did not return a Lifewood project record. Do not use either of those client projects for promotion tests. Confirm the intended isolated/staging project or restore a disposable Lifewood test project before running an end-to-end replacement test.

Before any deployment, the promotion SQL still requires execution against an isolated database with fixtures covering:
- First publication with no predecessor.
- Single-location replacement.
- Multi-location replacement where one run owns responses in several locations.
- Multiple predecessor lineage levels.
- Cross-date lineage exclusion.
- Full-run and source-run predecessor rejection.
- Orphaned daily metric rejection.
- Daily-claim reassignment.
- Batch first-category retry after partial failure and after promotion failure.
- Candidate validation failure and SQL exception rollback.
- Overall aggregate rebuild with all categories present, and stale Overall invalidation when a category is missing.

Only after these tests pass should the migration be applied to the intended Supabase environment, followed by Edge Function deployment. A Production historical deletion inventory and separate approval remain mandatory.


## 2026-11-13: multi-location aggregate selection and retry hardening

Additional commits:
- `13e70990a2c4396d28ff5971039eca7fdf5f7da8` — update Overall/cross-engine aggregation to select category runs by their per-location `visibility_daily` rows rather than the run row's single `tracking_location`.
- `8b46bbc4c1bb24b897b18ab59ba83deb0c20fbf6` — retain candidate run IDs parsed from Edge Function HTTP error responses.
- `5e988fc2dc5c924667e133f5bc9b5ac47050dbd3` — require the candidate's primary tracking location to be present in its staged metric locations.

### Multi-location correction

A `tracking_runs` row has one `tracking_location`, while its raw responses and `visibility_daily` rows may cover multiple locations. The location-aware finalizer already uses each metric row's own location, but the existing Overall and cross-engine aggregators selected category runs using only `tracking_runs.tracking_location`. That would omit secondary locations for a multi-location candidate.

The location-helper migration now also updates those two aggregators to select category runs through matching `visibility_daily` rows for the requested project/date/category/provider/location. The promotion RPC still explicitly supersedes exact-scope predecessor IDs for every location before publication. It also checks that the run row's primary location is one of the candidate's staged locations.

### Batch retry correction

When the first category fails after a daily claim is created, resuming the same batch now checks the existing claim. If it belongs to the same requester and category and is not actively running, a new candidate may replace the claim's run ID. If the prior candidate was already published but the client missed the response, the Edge Function marks the batch category complete from the published run rather than rerunning prompts. Candidate IDs returned in HTTP error payloads are saved in the batch row for recovery.

These paths remain feature-branch-only and require isolated database integration tests.


## 2026-11-14: atomic promotion integration and isolated database smoke workflow

### Repository state

- Branch: `feat/replace-rerun-data`
- The category-scoped atomic promotion migration is present:
  `supabase/migrations/20261113150000_promote_tracking_run_candidate_atomically.sql`.
- The Edge Function calls `promote_tracking_run_candidate` only after a candidate is completed. Promotion failure returns `CANDIDATE_PROMOTION_FAILED` and leaves the candidate completed but unpublished.
- This promotion path is limited to category-scoped `category` runs. Full-run replacement is deliberately not implemented and must not be represented as supported.

### Work completed in this continuation

1. Added `.github/workflows/replacement-rerun-db-tests.yml`.
   - Runs on pushes to `feat/replace-rerun-data`, pull requests targeting `main`, and manual dispatch.
   - Installs the Supabase CLI on a GitHub-hosted runner.
   - Starts a disposable local Supabase stack and applies the full migration chain with `supabase db reset --local`.
   - Runs a SQL schema/security contract test.
   - Stops the local stack even when a prior step fails.
   - Does not connect to the hosted Supabase project or require Supabase credentials.

2. Added `supabase/tests/replacement_rerun_schema_contract.sql`.
   - Verifies the staging, validation, preview and promotion RPCs exist.
   - Verifies candidate staging and replacement audit relations exist.
   - Verifies staging RLS is enabled and client roles cannot read staging rows.
   - Verifies promotion is SECURITY DEFINER, executable by service_role, and not executable by public/anon/authenticated.

3. GitHub Actions started automatically after the commits:
   - Workflow run: [Replacement Rerun Database Smoke Tests](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/43551594407)
   - Run status at the time of this update: in progress.
   - Commit adding workflow: `f0a27b621778f9b111333a734629f78826c7fcb8`.
   - Commit adding SQL contract: `641aaedab130b46cb4df6404c1e8e79342042f5a`.

### Important test limitation

The new workflow is the first isolated migration-chain and security smoke test. It is not yet the complete behavioural test suite. It does not yet create synthetic tracking projects/runs or prove successful replacement, failed-candidate preservation, multi-location isolation, Overall rebuild, concurrency, or rollback. Those tests remain mandatory before Production deployment.

### Next actions

- Inspect the first GitHub Actions run and fix any CLI, migration, schema-contract or workflow failures.
- Add synthetic fixture-based SQL integration tests for the promotion transaction.
- Specifically test first publication, single- and multi-location replacement, predecessor lineage, date/provider/project/category isolation, failed validation, source-run FK rejection, daily-claim handling, Overall rebuild/invalidation, and transaction rollback.
- Complete the Edge Function write-path and frontend/API consumer audit.
- Review and correct any promotion SQL issues revealed by the tests before any deployment.
- Keep all work on `feat/replace-rerun-data`; do not merge or deploy yet.

### Safety and cost status

- This workflow uses a disposable local Supabase stack on a GitHub-hosted runner. It does not create a Supabase branch or provision a paid Supabase resource.
- No hosted Supabase migration has been applied.
- The updated Edge Function has not been deployed.
- No Production data has been changed or deleted.
- Dr D Signature Clinic, MDLand and unrelated projects remain out of scope.
- Historical cleanup still requires a read-only inventory and separate explicit approval before any Production deletion.


## 2026-11-14 follow-up: local migration test blocked by missing baseline schema

The first GitHub Actions execution exposed a repository-level testing prerequisite:

- The local `supabase/migrations` directory begins at `20261009070000_repair_topic_mappings_and_backfill_competitors.sql`.
- That migration immediately references `public.prompts`, which does not exist in a fresh local Supabase database.
- The hosted Supabase project's migration history shows earlier foundational migrations beginning with `20261008034612_initial_visibility_platform_schema`, plus several auth/RLS/permission bootstrap migrations. Those foundational migrations are recorded in the hosted project's migration history but are absent from the repository's migration directory.
- Therefore `supabase db reset --local` cannot replay the repository's migration chain from an empty database. This is not a failure of the new replacement migrations; it is a missing historical baseline in source control.

The workflow run failed at the first existing migration with:
`ERROR: relation "public.prompts" does not exist`.

Actions taken:
- Changed the replacement DB workflow to manual dispatch only so it does not create a permanently failing required check on every feature-branch push or pull request.
- Corrected the SQL contract's PUBLIC execute-privilege check to inspect the function ACL directly.
- Retained the workflow as a ready test harness, but it must not be considered passing or usable until the baseline schema is restored.

### Required next testing-environment work

1. Recover or reconstruct a schema-only baseline from the hosted project's foundational schema/migration history, without copying Production data.
2. Add the baseline to source control in a controlled, reviewed form, or create a dedicated isolated test bootstrap that reproduces all dependencies required by the migration chain.
3. Confirm the bootstrap includes required extensions, auth/storage schemas, enums, functions, triggers, RLS policies, and base tables.
4. Re-run `supabase db reset --local` and the replacement schema/security contract.
5. Only after the schema bootstraps successfully, add synthetic behavioural fixtures for promotion, replacement, rollback and isolation.

The hosted Supabase project was queried read-only for migration history and table metadata to diagnose this issue. No migration was applied and no data was modified. No Supabase branch or paid Supabase resource was created.

The two initial workflow attempts failed during Docker image pulls with transient ECR rate-limit messages, then proceeded far enough to expose the missing `public.prompts` baseline dependency. Both runs ultimately failed; neither reached the new contract SQL.

### Current test status correction

- [x] GitHub Actions workflow and schema/security smoke test files committed.
- [x] Workflow execution attempted on isolated GitHub-hosted runners.
- [x] Missing baseline migration dependency identified.
- [ ] Fresh local database migration replay.
- [ ] Replacement schema/security contract passing.
- [ ] Synthetic behavioural integration tests.
- [ ] Full replacement workflow verified in isolation.

Do not describe database smoke tests as passing. No Production deployment or deletion has occurred.

## 2026-11-14: baseline recovery investigation continued

### Deployment status clarification

The user confirmed that the latest deployments shown in their screenshot are successful/Ready. These are deployment statuses, not proof that the Supabase migration replay or replacement database tests passed. The replacement workflow's prior run remains failed before the replacement contract test could execute.

### Read-only hosted migration/schema audit

Read-only Supabase inspection confirmed that the hosted project's migration history contains foundational versions absent from the repository's `supabase/migrations` directory. The hosted history includes, among others:

- `20261008034612 initial_visibility_platform_schema`
- `20261008034733 raw_response_retention_and_auth_bootstrap`
- `20261008034950 tighten_rbac_and_raw_retention`
- `20261008035028 revoke_remaining_public_function_execute`
- `20261008041322 restore_rls_function_permissions`
- `20261008041332 grant_authenticated_table_access_for_rls`
- `20261008042328 complete_platform_data_model`
- `20261008042545 secure_private_llm_secrets`
- `20261008042611 add_profile_email_for_account_management`
- `20261008051216 allow_project_admins_to_view_member_profiles`
- `20261009012544 grant_llm_key_management_service_role_access`
- `20261009012735 secure_llm_secrets_storage`
- `20261009014712 add_visibility_tracking_runs_and_indexes`
- `20261009015739 grant_service_role_visibility_tracking_access`
- `20261009024746 enforce_one_tracking_run_per_project_myt_day`
- `20261009025013 fix_daily_tracking_claim_transaction_order`
- `20261009040731 fix_daily_tracking_claim_ambiguous_conflict_target`

The repository's first migration file is `20261009070000_repair_topic_mappings_and_backfill_competitors.sql`, which assumes `public.prompts`, `public.citations`, `public.visibility_daily`, `public.ai_responses`, `public.projects`, and `public.competitors` already exist. The file's timestamp/name also does not match the corresponding hosted migration history sequence. This is broader than one missing table: the checked-in migration history is incomplete and has drifted from the hosted migration ledger.

Read-only catalog inspection also confirmed the current hosted schema has 31 base tables across `public` and `private`, an `app_role` enum, multiple extensions, dozens of functions, and triggers governing publication, user protection, reporting and competitor recomputation. A faithful local baseline must therefore preserve more than table columns: constraints, indexes, policies, grants, functions, triggers, storage/auth dependencies and extension requirements all matter.

### Decision: do not fabricate a partial baseline

Do not create a guessed bootstrap migration from table names or column metadata alone. That could make a fresh database appear to migrate while silently omitting critical RLS policies, grants, triggers, helper functions or foreign-key semantics. It could also conflict with later migrations that assume the original migration ordering.

Preferred recovery order:

1. Search repository history/other branches and retained project files for the original foundational SQL migration files.
2. If unavailable, produce a schema-only export from the hosted database using a supported Supabase CLI/database dump workflow with the appropriate read-only database credentials supplied by the project owner. Do not export application rows or secrets.
3. Reconcile the export against the hosted migration ledger and the current checked-in migration files. Preserve exact historical ordering and names where possible; document any unavoidable baseline squash explicitly.
4. Recreate a disposable local Supabase database from that schema-only baseline and replay the remaining migrations.
5. Only then run the replacement schema/security contract and synthetic behavioural tests.

### Current safety status

- Hosted inspection was read-only (migration history, table metadata, extensions, function signatures and trigger metadata).
- No DDL was applied to the hosted project.
- No client/business data was exported as part of this investigation.
- No paid Supabase branch or resource was created.
- No Production Edge Function deployment or data deletion occurred.
- The successful deployments in the user's screenshot do not change these database-test limitations.

### Immediate next action

Continue searching GitHub branches/commit history and project files for the original baseline SQL. If it cannot be recovered, request a schema-only dump from the project owner rather than guessing or applying an unverified schema reconstruction.

## 2026-11-14: recovered prior schema-backup handover; baseline recovery path clarified

A search of the user's Library and prior conversation files found an existing detailed handover, `Lifewood_Supabase_Cleanup_Handover.md`, documenting that a schema-only Supabase export was already created on the user's Windows machine. This changes the recovery plan: we may not need to generate a new export.

### Existing schema backup documented in the handover

- Folder: `C:\\Users\\Slimzito21\\AI-Visibility-Database-Backup`
- File: `schema.sql`
- Size: 219,243 bytes (~219 KB)
- Created with `npx supabase db dump --remote "$env:DB_URL" --file schema.sql`
- Described contents: app schema, functions, constraints, indexes, policies, triggers and extensions.
- A separate `schema_restore_test.sql` was also created for local restore testing, omitting the `pg_cron` extension declaration.
- The same handover documents a local Supabase environment at `C:\\Users\\Slimzito21\\supabase-restore-test`, with a database named `lifewood_backup_test`.
- That local database's app schema was previously checked as 32 tables across public/private, 1 view, 49 functions, 12 triggers, 99 indexes and 44 RLS policies. The data restore is a separate concern and must not be imported for this replacement feature test.

### Security boundary

The handover also documents a separate `data.sql` (~234.65 MB) containing Auth records, including email addresses and password hashes. Do not request, upload, inspect or use `data.sql` for the replacement test environment. The schema-only `schema.sql` is the relevant artifact; inspect it for secrets/credential literals before adding it to GitHub. Prefer a sanitized schema-only fixture with secrets removed and test-only placeholders.

### Updated recovery plan

1. Ask the user to attach only `schema.sql` (or `schema_restore_test.sql` if it is the already-validated restore-safe variant). Do not ask for `data.sql`, `roles.sql`, the ZIP, or any connection string.
2. Inspect the schema dump for hard-coded secret values, project-specific data, extension dependencies and local Supabase managed-schema assumptions.
3. Create a sanitized, reproducible local baseline under a dedicated test-only path in the repository (or a documented bootstrap script) without importing any production rows or secrets.
4. Use GitHub Actions to initialize the required Supabase-managed schemas/services, apply the schema-only baseline, and run the replacement migrations/contracts. If the baseline dump is not directly replayable against the CI Supabase image, adapt the test harness based on the actual SQL errors rather than fabricating DDL.
5. Keep original backup files unchanged. Never commit raw production data or credentials.

### Correction to prior status

The repository's historical migration chain is still incomplete, and the existing CI `db reset` remains blocked. However, the user already has a documented schema-only backup on their local machine. Therefore, the next blocker is obtaining the exact schema-only file in this conversation/workspace so it can be reviewed and adapted for CI, not creating a fresh export from Production.

### Safety status

No Production DDL, Edge Function deployment or data deletion occurred. No Supabase paid branch/resource was created. No backup data dump was requested or accessed. All replacement implementation work remains on `feat/replace-rerun-data`.

## 2026-11-14: uploaded schema-only baseline inspected and wired into CI

### Uploaded backup inspection

The user uploaded `schema.sql` (219,243 bytes, 4,965 lines). It was read and inspected before use. Static scan results:

- 32 `CREATE TABLE` statements (including the private secrets table and its public legacy counterpart)
- 49 `CREATE OR REPLACE FUNCTION` statements
- 44 RLS policies
- 8 explicit triggers
- 1 view
- 60 explicit index statements
- 5 extension declarations in the original file
- No `COPY` statements and no top-level `INSERT INTO` statements, so it is a schema-only dump with no application rows.
- No obvious API-key formats, private-key blocks, JWT-like literals, or database connection strings detected by the static scan.

The baseline includes the schema of `llm_secrets` and `llm_configs` tables, but no rows/secret values. The original uploaded file was not modified. The test fixture omits the `pg_cron` extension declaration because pg_cron is not required for replacement-rerun tests and may not be enabled in the hosted runner's local database image. The other schema definitions, policies, grants, triggers, and functions are retained.

### Baseline fixture committed

The schema dump was split into five ordered SQL parts to fit repository file operations without truncating content:

- `supabase/tests/fixtures/schema_baseline/part-01.sql`
- `supabase/tests/fixtures/schema_baseline/part-02.sql`
- `supabase/tests/fixtures/schema_baseline/part-03.sql`
- `supabase/tests/fixtures/schema_baseline/part-04.sql`
- `supabase/tests/fixtures/schema_baseline/part-05.sql`

The workflow concatenates these files into a temporary SQL file at runtime. The parts are test fixtures only; they are not added to the production migration chain and do not import client/application rows.

### CI workflow changed to use the baseline snapshot

Updated `.github/workflows/replacement-rerun-db-tests.yml` to:

1. Start a disposable local Supabase stack on GitHub Actions.
2. Concatenate the five schema fixture parts.
3. Assert the assembled baseline contains no top-level `COPY` or `INSERT INTO` data statements.
4. Restore the schema-only baseline into the disposable local database.
5. Apply only the seven replacement-rerun migrations in order, rather than replaying the incomplete historical migration directory from scratch.
6. Run `replacement_rerun_schema_contract.sql` to check required RPCs, RLS and grants.
7. Stop the local stack.

The workflow is again triggered on feature-branch pushes, pull requests to main, and manual dispatch.

### Current CI run

- Run: [Replacement Rerun Database Smoke Tests](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/43553107282)
- Commit: `afca859967cd67182de95904ab983660edefa905`
- Status at the time of this update: `in_progress`; Supabase CLI setup succeeded and the local Supabase stack was starting. Baseline restoration, feature migration replay and SQL contract have not yet reported results.

### Important caveat and next steps

This schema snapshot is a point-in-time schema-only restore, not a reconstruction of every historical migration version. It is intentionally used as a test fixture baseline, then the new replacement migrations are applied on top. It should not be treated as a replacement for restoring the historical migration ledger in the Production project.

The schema snapshot includes the existing live functions/triggers but does not include the new replacement staging/audit objects, which are supplied by the seven feature migrations. If the local restore fails due to missing Supabase-managed schemas/extensions or unsupported dump statements, adapt the isolated harness based on the actual error. Do not alter the live database to resolve local test issues.

After the schema/security smoke test passes, add synthetic behavioural tests for first publication, successful replacement, failed candidate preservation, multi-location isolation, exact-scope boundaries, Overall rebuild/invalidation, daily-claim and FK handling, concurrency, and rollback.

### Safety status

- Only schema definitions were used; no application rows were included in the test fixture.
- No `data.sql`, Auth dump, or project secrets were requested or used.
- The original uploaded `schema.sql` remains unchanged.
- No hosted Supabase migration or DDL was applied.
- No Supabase paid branch/resource was created.
- No Production Edge Function deployment or historical deletion occurred.
- Dr D Signature Clinic, MDLand and unrelated projects remain out of scope.

## 2026-11-14: local migration replay passed; RPC security contract expanded

### Successful isolated database replay

GitHub Actions run [43553464032](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/43553464032) completed successfully. Every step passed:

- Supabase CLI setup.
- Disposable local Supabase stack startup.
- Schema-only baseline fixture assembly.
- Restore of the schema-only baseline.
- Application of all seven replacement-rerun migrations.
- Replacement schema/security contract.
- Local stack shutdown.

This confirms that the baseline snapshot can be restored in CI and that the current feature migrations apply successfully on top of it. It does not yet prove end-to-end promotion behaviour with synthetic project/run data.

### Security contract strengthened

Updated `supabase/tests/replacement_rerun_schema_contract.sql` to check all four candidate-management RPCs:

- `stage_tracking_candidate_rows`
- `validate_tracking_run_candidate`
- `preview_tracking_run_replacement`
- `promote_tracking_run_candidate`

For each RPC, the contract now verifies that service_role has execute permission, anon/authenticated do not, PUBLIC does not, and the function is SECURITY DEFINER with a fixed `search_path=public, pg_temp`. Existing staging-table RLS and browser-role SELECT checks remain.

- Contract update commit: `dfe03aa3a08f5a958aca68185a48ba4aa5738580`
- Follow-up CI run: [43553708963](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/43553708963), queued at the time of writing.

### Next testing stage

Add isolated synthetic behavioural tests with minimal fixtures. Cover:

1. Candidate validation rejects missing/incomplete/unpublished-invalid states without modifying canonical data.
2. First publication with no predecessor.
3. Successful exact-scope replacement, including predecessor removal and audit lineage.
4. A failed promotion rolls back all changes and preserves predecessor canonical rows.
5. Project/date/provider/category/location boundaries remain untouched.
6. Multi-location candidate behaviour and per-location metric aggregation.
7. Overall aggregation rebuild/invalidation.
8. Daily claim reassignment, source-run FK protections and batch reference behaviour.
9. Concurrent promotion serialization.

Avoid production data and live project writes. Keep all tests in the disposable local database. Review promotion SQL correctness based on those test results before deployment.

### Status and safety

- Migration replay on schema-only baseline: PASS.
- Initial schema/security contract: PASS.
- Expanded security contract: committed; follow-up CI pending.
- Synthetic behavioural promotion tests: NOT YET IMPLEMENTED.
- Production migration/Edge Function deployment: NOT performed.
- Production data modification/deletion: NONE.
- Paid Supabase resource: NONE.


## 2026-11-17: fresh live schema and complete Edge Function audit

### Repository and CI state

- Feature branch: `feat/replace-rerun-data`
- Branch head before this audit's changes: `dc86cbe91d9616f42b2eaf03e3bdb7f691f4d699`
- Latest observed CI run: [#31](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44005365071), commit `dc86cbe91d9616f42b2eaf03e3bdb7f691f4d699`, **success**.
- The workflow currently runs schema/security, candidate validation, first publication, exact-scope replacement, forced rollback, and scope-isolation tests.
- The latest passing workflow does not yet prove multi-session concurrency, Overall invalidation/rebuild for all cases, or full-run replacement.

### Fresh hosted schema/trigger/FK audit (read-only)

Supabase project `jhauufmrxpsbfrahgclv` was confirmed `ACTIVE_HEALTHY` on PostgreSQL 17.11 in `ap-southeast-1`.

The hosted database has not received the feature migrations: the live catalog contains neither `tracking_run_candidate_rows` nor the staging/validation/preview/promotion RPCs. This confirms the feature branch remains isolated from hosted Production schema.

The current publication guard has enabled BEFORE INSERT and BEFORE UPDATE triggers on `tracking_runs`. On INSERT it derives `run_kind` from whether category is null. On publication UPDATE it supersedes the current matching run and invokes `finalize_run_metrics` for non-Overall runs.

Fresh FK findings:
- `tracking_runs.source_run_id -> tracking_runs.id`: NO ACTION.
- `tracking_runs.supersedes_run_id -> tracking_runs.id`: ON DELETE SET NULL.
- `tracking_run_daily_claims.run_id -> tracking_runs.id`: ON DELETE CASCADE.
- `tracking_batch_categories.tracking_run_id -> tracking_runs.id`: ON DELETE SET NULL.
- `third_party_mentions.response_id -> ai_responses.id`: ON DELETE SET NULL.
- `citation_occurrences.response_id -> ai_responses.id` and `response_brand_evidence.response_id -> ai_responses.id`: ON DELETE CASCADE.
- `category_brand_observations.run_id` and `visibility_daily.run_id`: ON DELETE SET NULL.

The existing replacement transaction explicitly reassigns a matching daily claim to the replacement run. The behavioural test deliberately verifies that historical batch-category rows detach their deleted run reference (the batch row itself remains), rather than retaining a dangling FK. This is the current batch-history policy.

### Complete `visibility-tracking/index.ts` write-path review

Reviewed all 1,553 lines on the feature branch, including retries, extraction failures, run setup, response persistence, evidence/citation generation, metric staging, finalisation and promotion.

Candidate-owned writes:
- `ai_responses`: raw response rows inserted under the candidate `run_id`.
- `tracking_run_stages`: stage journal upserts/updates only.
- `tracking_run_candidate_rows`: six derived table types staged through the service-role RPC: `citations`, `citation_occurrences`, `response_brand_evidence`, `third_party_mentions`, `category_brand_observations`, and `visibility_daily`.
- `tracking_runs`: candidate creation and status/error counters; the Edge Function does not set `published_at`.
- `tracking_run_daily_claims` and `tracking_batch_categories`: entitlement and orchestration bookkeeping.

The function no longer directly deletes or writes canonical derived citation/evidence/mention/observation/visibility rows before promotion. It does not write to legacy `competitors`, `direct_competitors`, or `direct_competitor_observations`.

Important non-candidate configuration side effects found: a compatibility bootstrap can upsert the tracked brand into `brand_registry` and create missing `category_brand_assignments` while a candidate is processing. These are configuration/registry writes, not published run metrics, but they can persist even if the candidate later fails. Review whether to remove this bootstrap from the tracking request or isolate it as an explicit setup action before deployment.

Important deployment limitation: the Edge Function calls the category-only `promote_tracking_run_candidate` for every completed non-sample run. Direct full-run candidates with a null category are rejected by the RPC. The current Dashboard's normal Run Tracking flow avoids this path: it iterates the selected categories and invokes the Edge Function once per category, so each call is a category-scoped `category` candidate and the batch publishes categories sequentially. Full-batch atomic replacement is not implemented; any other caller that submits a null-category full run must be gated or supported before deployment.

### Correctness issue identified and hardened on the feature branch

The original promotion function built its predecessor preview before acquiring the advisory transaction lock. Two concurrent candidates could therefore both observe the same old predecessor; the second could wait for the first promotion and then continue using stale predecessor IDs. That could leave the first candidate's raw response data behind while replacing its aggregates.

The promotion migration is being hardened to:
1. Derive the exact candidate date and locations from validated staged data.
2. Acquire sorted advisory transaction locks for each project/date/category/provider/location scope.
3. Revalidate the candidate after locking.
4. Rebuild the predecessor preview only after the lock is held.
5. Use the refreshed predecessor IDs for all deletion and audit operations.

The candidate staging key is also being hardened to use JSON-encoded identity parts and include `source_type` and `citation_index`, avoiding delimiter collisions and preventing distinct third-party source types from overwriting each other.

A schema-contract assertion is added to enforce that the advisory lock occurs before predecessor preview in the promotion function definition.

### Remaining work

- Run the updated isolated CI workflow and record the exact result/commit.
- Add actual multi-session concurrency coverage; the lock-order contract is not a substitute for a two-session behavioural test.
- Add multi-location promotion tests and full Overall rebuild/invalidation coverage.
- Complete frontend/API consumer audit, including full feature-branch traversal and legacy `competitors` usage.
- Decide whether failed-candidate brand-registry bootstrap side effects should be removed or separated.
- Decide and implement full-run behaviour before deploying the updated Edge Function generally.
- Run lint/type checks and Edge Function tests.
- No hosted migration, Edge Function deployment, Vercel deployment, or Production data deletion has been performed. Dr D Signature Clinic, MDLand and unrelated projects remain out of scope.


### 2026-11-17 continuation: app consumer audit and passing lock-order hardening CI

The lock-order and staging-key hardening commit `c8c58a02120d4b1b6081d5b22f44c3588863b3f5` passed GitHub Actions run [#32](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44006273262). All existing isolated steps passed: schema-only baseline restore, feature migrations, schema/security contract, candidate validation, first publication, exact-scope replacement, forced rollback and scope isolation.

### Feature-branch frontend/API consumer audit

Traversed all 58 TypeScript/TSX files under `app/`, `components/` and `lib/` on the feature branch.

Findings:
- No frontend query or component reads `tracking_runs`, `tracking_run_replacements`, or `tracking_run_candidate_rows` directly. Candidate staging and replacement audit remain server-side.
- Dashboard reads `visibility_daily` and uses `tracking_batches` / `tracking_batch_categories` for category orchestration and resumable batch status. The existing replacement test confirms a deleted predecessor's batch-category FK detaches to NULL while preserving the batch row.
- Responses reads `ai_responses`; after replacement it will naturally expose only the surviving raw responses for the replaced run scope.
- Citations uses `get_cumulative_citations` and `get_third_party_mentions` RPCs. Reports use `visibility_daily`, `third_party_mentions`, `brand_registry`, and report RPCs.
- Analytics and leaderboards use canonical `visibility_daily` and `category_brand_observations` rows.
- The Competitors page uses the configured brand registry and direct-competitor metrics workflow. The live `get_direct_competitor_metrics_for_period` function consumes `direct_competitors` and `direct_competitor_observations`; these must remain untouched by visibility reruns.
- No `public.competitors` table consumer was found in the 58 frontend files or in the current live public SQL function definitions. This is not proof that external scripts or untracked clients do not consume the legacy table, so it remains preserved.

### Overall aggregation test added

A new disposable SQL behaviour test covers:
1. A complete single-category candidate creates a published Overall aggregate whose `source_run_ids` points to the candidate.
2. When all configured categories have valid runs, replacing one category rebuilds Overall using the replacement plus the latest surviving sibling category run.
3. When a configured category is missing, the previous Overall rows are invalidated rather than left stale.

This test is wired into the feature-branch GitHub Actions workflow. Its result is pending until the next CI run completes.

### Still outstanding

- The lock-order contract is passing, but an actual two-session concurrency test is still required.
- Add a multi-location promotion test if/when the project schema supports multiple configured locations; the current `projects.tracking_locations` constraint enforces exactly one configured location.
- Complete a controlled category rerun in an isolated hosted test environment before Production deployment.
- Resolve the full-run limitation and decide how to isolate the tracked-brand registry bootstrap side effects.
- Run Deno/TypeScript lint and Edge Function tests; current CI is database-focused.
- No hosted migration, Supabase Edge Function deployment, Vercel deployment, or Production data deletion has been performed.


### 2026-11-17: Overall refresh lock and fixture correction

A further concurrency review found that category-specific advisory locks alone do not serialize two different category promotions that both refresh the same Overall aggregate. Added a second, shared advisory lock keyed by project/Malaysia date/provider/location with the reserved `__OVERALL_REFRESH__` segment. Category locks are acquired first, then shared Overall locks, both in sorted location order, before the predecessor preview. This prevents simultaneous category promotions from rebuilding the same Overall snapshot against interleaved category membership.

The schema/security contract now verifies that both lock types precede predecessor preview.

The first run of the new Overall behaviour test reached the test step and failed due to a fixture statement returning two prompt IDs into one scalar variable. The fixture has been corrected to insert the Skin and Mind prompts separately. The CI run's database migration, schema/security, candidate validation, first-publication, exact replacement, rollback and scope-isolation steps all passed before that fixture failure.

The shared Overall lock and fixture correction are committed together; the next CI run must pass before Overall rebuild/invalidation is marked verified.


### 2026-11-17: derived-data and source-run FK behavioural coverage added

Added disposable SQL behavioural tests for the full six-table candidate staging/promotion path and the `tracking_runs.source_run_id` NO ACTION dependency.

The derived-data test creates a synthetic predecessor and replacement candidate with citations, citation occurrences, response-brand evidence, third-party mentions, category observations and visibility metrics. It verifies that predecessor raw/derived rows are removed, candidate staged rows become canonical, and the legacy `competitors` sentinel plus `direct_competitors` / `direct_competitor_observations` remain unchanged.

The source-run FK test creates a child run referencing the predecessor through `source_run_id`. Promotion must reject with `predecessor_is_referenced_as_source_run` and preserve the published predecessor, its raw response and metric, the completed unpublished candidate, its staged rows, and the source provenance row.

Both tests are wired into the isolated GitHub Actions workflow. Their results are pending the next CI run.


### 2026-11-17: concurrent same-scope test added

Added a two-session PostgreSQL behavioural test. It publishes an initial predecessor, prepares two completed candidates for the same exact scope, starts the first promotion and waits until both its category and shared Overall advisory locks are held, then starts the second promotion while the first transaction is still open. The second promotion must wait, refresh predecessor discovery after acquiring the lock, and replace the first candidate. Verification requires only the second candidate's run/raw response/metric to survive and both replacement audit edges to remain.

The test runs only against the disposable local database and deletes its synthetic project after verification. Its result is pending the next CI run.


### 2026-11-17: Edge Function and application quality checks wired into CI

The workflow now has a separate `app-edge-quality` job that installs the application dependencies, runs `tsc --noEmit`, type-checks `supabase/functions/visibility-tracking/index.ts` with Deno, and runs the visibility-tracking Deno unit tests. This keeps code-quality checks independent from the disposable database job.

The repository has no checked-in ESLint configuration despite the `npm run lint` script, so ESLint has not been claimed as passing. A lint configuration decision remains separate from the current database/Edge Function correctness work.


### 2026-11-17: CI results and concurrency-test teardown correction

- Overall rebuild/invalidation test: **PASS** in run [#35](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44007142611).
- Full derived-data replacement test (all six staged tables plus preservation of legacy/direct competitor data): **PASS** in run [#35](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44007142611).
- `source_run_id` NO ACTION rejection and predecessor/candidate preservation: **PASS** in run [#35](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44007142611).
- Application TypeScript check, Deno Edge Function type-check and all visibility-tracking Deno unit tests: **PASS** in the `app-edge-quality` job of run [#37](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44007343705).

The first concurrency run [#36](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44007251627) successfully completed the concurrent-promotion assertions: the first and second candidate promotions serialized, the second candidate became canonical, both earlier runs/raw responses were removed, and two audit edges remained. The job then failed during synthetic-project teardown because deleting the project cascaded to prompts while `ai_responses` retained a prompt FK. The test script now deletes its synthetic `ai_responses` before deleting the project. This was a test cleanup defect after the assertions, not a replacement assertion failure; the corrected script must pass in a fresh CI run before concurrency is marked complete.

The Dashboard uses sequential category-scoped Edge Function calls for its normal multi-category Run Tracking batch. Each category replacement and its Overall refresh are atomic; the batch as a whole is not atomic. Full-batch atomicity remains a separate capability.


### 2026-11-17: competitor recompute integration dependency identified

The application audit found an active Competitors-page action: `request_competitor_recompute` enqueues a project recomputation. The live `recompute_competitor_metrics` worker rewrites `response_brand_evidence`, `citation_occurrences`, `category_brand_observations`, tracked-brand visibility fields, and then calls the Overall publisher. It can therefore race a category replacement even though it does not use the legacy `competitors` table.

Added a shared project-scoped transaction advisory lock (`__TRACKING_REPLACEMENT_RECOMPUTE__`) to:
- The replacement promotion RPC, before scope locks and predecessor discovery.
- `publish_engine_overall_metrics`, covering direct Overall refresh callers.
- `recompute_competitor_metrics`, covering the queued competitor recompute worker.

This intentionally serializes a project's replacement promotion with its competitor recompute. The exact category/location locks and shared Overall lock remain in place. The new migration applies the same lock to the current live function definitions using guarded source replacement; it fails closed if the expected function anchors are absent. The schema contract checks that all three paths contain the shared lock and that promotion acquires it before preview.

This is an additional migration dependency and is not yet applied to hosted Supabase. CI must replay the new migration and rerun the behavioural suite before this coordination is considered verified.


### 2026-11-17: project-wide recompute coordination CI passed

GitHub Actions run [#39](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44008031362), commit `4f24e54938085d4e832c33a209788ea345078953`, **passed both jobs**:
- Database job: restored the schema-only baseline, applied all replacement migrations including the new competitor-recompute coordination migration, passed schema/security contract, candidate validation, first publication, exact replacement, rollback, scope isolation, Overall rebuild/invalidation, six-table derived replacement, source-run FK rejection, and two-session same-scope concurrency.
- Application/Edge quality job: `tsc --noEmit`, `deno check` for the tracking Edge Function, and all visibility-tracking Deno unit tests passed.

The application audit was completed across all 58 TypeScript/TSX files under `app/`, `components/` and `lib/`. The normal Dashboard Run Tracking flow creates a batch and invokes `visibility-tracking` once per category, in order. It updates the current batch-category row with the newly promoted run ID; when a later rerun deletes a predecessor, older batch rows detach their FK and retain their completed status. The Dashboard does not query `tracking_runs` for historical run presentation.

The active competitor recompute path is now explicitly coordinated: the Competitors status component calls `request_competitor_recompute`, which enqueues a worker that invokes `recompute_competitor_metrics`. That worker rebuilds evidence, citation occurrences, category observations and Overall, so it shares the same project lock as replacement promotion and direct Overall publication.

The current CI evidence covers category-scoped per-category replacement, not an all-categories atomic batch. The Dashboard's batch is sequential: each category replacement plus its Overall refresh is atomic, but the entire batch may show intermediate Overall snapshots while later categories are still running.

Exact continuation commits:
- `c8c58a02120d4b1b6081d5b22f44c3588863b3f5` — refresh predecessor preview under scope locks; harden deterministic staging keys.
- `95a2a1025c32195322f6acbc30273b08f9df4bac` — add Overall rebuild/invalidation test.
- `a85bb53340acf97984aba182a35b88b7dbae84f9` — serialize shared Overall refresh across categories.
- `429c9ab085f58f9f8dedd1b905f675f6525cfbf3` — derived-data and source-run FK behavioural tests.
- `0fda8b5c274bc4a6022d59d663df6d818ce151a9` — two-session concurrency test and quality workflow.
- `91557c16e19a5e9a351e7032f866cc1e8b0e2aae` — application/Edge quality job.
- `19fa05615eaa141bdccf930c5ecb68e3817d898e` — fix concurrency-test teardown; CI run #38 passed.
- `4f24e54938085d4e832c33a209788ea345078953` — coordinate competitor recompute and Overall publication with replacement locks; CI run #39 passed.

The schema contract is further tightened to assert the executable advisory-lock key expressions, not merely the sentinel comments.

### 2026-11-17: candidate staging isolation and failure-path tests

Commit `55393fd02aeab0badd8c53d627da02d9fa93e38f` extracts the Edge Function's candidate-row staging operation into `candidate-staging.ts` and adds dedicated Deno tests.

Coverage added:
- Candidate rows are chunked and submitted with the exact run ID and target table.
- `source_type` and `citation_index` remain part of the deterministic identity, so distinct third-party source types and citation occurrences do not collapse into one staged row.
- A staging RPC error throws a table-specific `CANDIDATE_STAGING_FAILED` error, preventing the handler from silently continuing.
- Missing run IDs and empty row sets perform no RPC calls.

GitHub Actions run [#43](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44009545105), commit `55393fd02aeab0badd8c53d627da02d9fa93e38f`, **SUCCESS**. Both jobs passed:
- Application/Edge quality: `npx tsc --noEmit`, `deno check supabase/functions/visibility-tracking/index.ts`, and all visibility-tracking Deno unit tests, including the new staging tests.
- Disposable local database: schema-only baseline restore, replacement migrations, schema/security contract, candidate validation, first publication, exact replacement, forced rollback, scope isolation, Overall rebuild/invalidation, six-table derived-data replacement, source-run FK rejection, and concurrent same-scope replacement.

The CI run used only a disposable local Supabase stack and stopped it successfully. It did not connect to the hosted Supabase project.

Exact current feature-branch head after this code commit: `55393fd02aeab0badd8c53d627da02d9fa93e38f`.

### 2026-11-17: emergency tracking pause gate and deployment planning

Commit `2b3ffc9dca3d687b8de2142efd362bd297bbe828` adds an explicit emergency stop to the `visibility-tracking` Edge Function:
- The `TRACKING_REPLACEMENT_PAUSED` secret is checked immediately after CORS preflight and before auth, database access, run creation, provider calls, staging, or promotion.
- When set to `true`, the function returns HTTP 503 with `TRACKING_TEMPORARILY_PAUSED` and states that no run was started.
- A Deno unit test verifies that only an explicit case-insensitive `true` value activates the pause.

GitHub Actions run [#45](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44009915868), commit `2b3ffc9dca3d687b8de2142efd362bd297bbe828`, **SUCCESS**. Both jobs passed: the disposable local database replacement suite and the application/Edge quality job, including the pause-gate unit test.

A read-only tree comparison against `main` confirmed that the release changes three deployment surfaces: eight Supabase migrations, the `visibility-tracking` Edge Function, and the Dashboard category-batch flow in `app/platform/[projectId]/dashboard/page.tsx`. Therefore Vercel deployment is also required; this is not a database-only release. The `supabase/config.toml` change is for local CI behavior and must not be treated as a hosted config change.

A controlled rollout/rollback runbook has been added at [`docs/REPLACEMENT_RERUN_DEPLOYMENT_RUNBOOK.md`](./REPLACEMENT_RERUN_DEPLOYMENT_RUNBOOK.md). It is a plan only and has not been executed. Its core rollback rule is pause first and repair forward; do not redeploy the old direct-write Edge Function as an automatic rollback.

### Current deployment blockers

- No separate hosted non-Production Supabase project is available for a hosted integration rehearsal.
- A full mocked Edge Function request-flow test is still outstanding. The current suite has focused unit tests, Deno type-checking, and database behavioural tests.
- The tracked-brand registry bootstrap side effect still requires review.
- A fresh live schema/migration-history audit and exact pending-migration reconciliation are required immediately before any hosted change.
- Explicit approval is still required before Production migrations, Edge Function deployment, or Vercel Production deployment. Historical Production deletion requires separate explicit approval.




### 2026-11-17: executable lock contract correction and final CI verification

The first strengthened lock-contract attempt in commit `ed7e555c062dcdea8381bf797b00bb848f8748bb` failed in CI run [#40](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44008575836) because the test expected an abbreviated Overall lock-key expression that did not match the complete project/date/provider/location key in the function. No migration or application code failed in that run; the assertion itself was incorrect.

Corrected the contract to match the full executable SQL expressions and reran CI in commit `4b98160868f59dcfc02d6dbd9c2da5c0a6583120`.

GitHub Actions run [#41](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44008604915): **SUCCESS**. Both jobs passed:
- Database job: complete schema-only baseline restore, all migrations including competitor-recompute coordination, executable lock contract, all replacement SQL behavioural tests, and concurrent same-scope promotion test.
- Application/Edge job: TypeScript type-check, Deno Edge Function type-check, and all visibility-tracking Deno unit tests.

Current feature-branch head before this handover-only update: `4b98160868f59dcfc02d6dbd9c2da5c0a6583120`.

### Remaining work after CI #41

1. **Edge Function integration audit/testing:** the complete 1,553-line function has been reviewed and Deno type/unit tests pass, but a mocked end-to-end request test should still prove all provider/retry/error paths reach candidate staging and promotion correctly. The tracked-brand registry bootstrap remains a configuration side effect outside candidate staging and should be reviewed before deployment.
2. **Multi-location limitation:** the current project schema enforces exactly one configured tracking location. Location isolation is tested, but one candidate spanning multiple locations is not supported or proven. Do not claim multi-location candidate support.
3. **Full-run limitation:** the Dashboard's normal Run Tracking flow invokes one category at a time, so its normal batch path uses category-scoped candidates. A direct null-category full-run candidate is not supported by the promotion RPC. Full-batch atomicity is not implemented.
4. **Lint:** the repository has no checked-in ESLint configuration. TypeScript and Deno checks pass; ESLint has not been claimed as passing.
5. **Hosted controlled test:** no separate hosted non-Production Supabase test project is available in this workflow. CI tests use disposable local Supabase only.
6. **Deployment:** no hosted Supabase migration, Supabase Edge Function deployment, Vercel deployment, merge to `main`, or Production data change has been performed. Before any hosted deployment, re-audit the live function/schema versions and present the exact migration and Edge Function changes for approval.
7. **Historical cleanup:** no inventory or deletion has been performed. A read-only inventory and exact deletion scope must be presented for approval before any Production historical deletion.

### Current safety status

- All replacement implementation and test changes remain on `feat/replace-rerun-data`.
- CI #41 passed on the disposable local database and GitHub runner.
- Dr D Signature Clinic, MDLand, and unrelated projects were not used as test targets or modified.
- Legacy `competitors`, `direct_competitors`, and `direct_competitor_observations` remain preserved.
- No Production historical data has been deleted.


---

# Latest Verification Update - 2026-11-17

**This section supersedes earlier status statements where they conflict.**

## Current status

- Feature branch: `feat/replace-rerun-data`
- Branch comparison: 114 commits ahead of `main`, 0 behind; main SHA at comparison: `2b7f94c65aa8ab1d7168f341eb11dc260129337a`.
- Latest fully verified CI: [run #45](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44009915868), commit `2b3ffc9dca3d687b8de2142efd362bd297bbe828`; both jobs passed.
- The database job passed the disposable schema restore, replacement migrations, schema/security contract, candidate validation, first publication, exact replacement, rollback, scope isolation, Overall rebuild/invalidation, six-table derived replacement, source-run FK rejection, and two-session concurrent replacement tests.
- The app/Edge job passed `npx tsc --noEmit`, Deno type-checking and all visibility-tracking Deno unit tests.

## Fresh hosted Supabase check

A read-only check of project `jhauufmrxpsbfrahgclv` found:

- Hosted migration history still ends at `20261112032011`; none of the eight replacement migrations is applied.
- Hosted `visibility-tracking` remains version 67.
- Retrieved deployed source does not include candidate staging, `TRACKING_REPLACEMENT_PAUSED`, or `promote_tracking_run_candidate`.

A Vercel deployment does not apply Supabase migrations or deploy the Edge Function. The exact current Vercel release commit was not independently verified. The replacement rerun is therefore not live in hosted Production.

## Edge Function audit: tracked-brand bootstrap

Resolved on `feat/replace-rerun-data`:

- Tracking-time writes to `brand_registry` and `category_brand_assignments` were removed.
- A pure read-only validator now requires the tracked-brand registry row and each configured category's tracked-brand assignment to exist before processing.
- Missing setup fails clearly and directs the operator to correct project Settings. No tracking request silently creates or changes brand configuration.
- Five unit tests cover valid setup, missing registry, missing category assignment, legacy normalized-key recognition, and competitor-vs-tracked-brand role separation.
- The handler was re-scanned: no insert/upsert/update/delete calls remain against either configuration table.

## Constraints

- Promotion supports category-scoped candidates only; full-run (`category = null`) promotion is not supported.
- Dashboard batches run categories sequentially. Each category replacement plus Overall refresh is atomic; the entire batch is not.
- The current project schema enforces one configured tracking location. Multi-location candidate runs are not supported/proven.
- Preserve `competitors`, `direct_competitors`, and `direct_competitor_observations`.
- Historical Production deletion remains a separate task requiring a read-only inventory and separate explicit approval.

## Next steps

1. Build a mocked end-to-end request-flow test for the actual Edge Function handler: auth/validation, provider retries, raw response persistence, all six staging paths, completion without publication, promotion only on success, promotion failure preservation, and pause-gate early exit.
2. Resolve and test the tracked-brand bootstrap side effect.
3. Arrange an isolated hosted Supabase rehearsal. Do not create a paid branch/resource without cost disclosure and required confirmation.
4. Re-audit live schema/FKs/triggers/grants/RLS/migration history, confirm backup/PITR, review exact release commit, then seek explicit approval before Production migrations, Edge Function deployment, or Vercel Production promotion.
5. Only after sandbox acceptance, consider unpausing and a controlled first replacement.

No Production replacement migrations, Edge Function deployment, Vercel Production promotion, or historical deletion is authorised by this update.


## Development update - 2026-11-17 (tracked-brand configuration safety)

Implemented on `feat/replace-rerun-data`:

- Added `tracked-brand-config.ts` with a pure, read-only validator for the tracked-brand registry and per-category assignments.
- Replaced the tracking-time fallback upserts to `brand_registry` and `category_brand_assignments` with fail-closed validation.
- Tracking now returns a clear failure if the tracked-brand registry row or category assignment is missing. Project setup must be corrected in Settings; tracking does not silently mutate it.
- Added five Deno tests covering valid configuration, missing registry row, missing category assignment, legacy normalized-key recognition, and rejection of a competitor assignment as the tracked brand.
- Re-scanned the Edge Function source after the change: no `insert`, `upsert`, `update`, or `delete` calls remain against `brand_registry` or `category_brand_assignments` in the tracking handler.

Commits:
- `848d50db886e0f29568168faabfda576d0063511` - remove tracking-time configuration writes.
- `4eda689afa897ab05daff5fcba269e7b3bb99b89` - add read-only validation helper.
- `17c52a54441086eb9f06a3ff714530f536c16ae5` - add validation tests.

Validation status:
- The new tests have been committed, but no passing CI result for these commits has yet been verified. The Vercel status was pending at the last check; this does not establish Supabase deployment or replacement readiness.
- The mocked end-to-end request-flow test remains outstanding. It must exercise the actual handler, including authentication, provider retries, raw response persistence, all six staging tables, successful promotion, promotion failure, and pause-gate early exit.
- No Production migration, Edge Function deployment, or historical deletion was performed.

## Development update - 2026-11-17 (candidate promotion gate)

Implemented on `feat/replace-rerun-data`:

- Extracted the final publication call into `candidate-promotion.ts`.
- The helper invokes `promote_tracking_run_candidate` only for a candidate whose status is exactly `completed`.
- A candidate is reported as published only when the RPC returns `status = published` with no error. RPC errors, null responses, and unexpected statuses fail closed.
- Updated the Edge Function to use the helper, retaining the existing HTTP 500 response and unpublished-candidate diagnostic behaviour when promotion is not confirmed.
- Added four unit tests: incomplete candidate does not invoke the RPC; completed candidate invokes the exact RPC arguments; RPC error remains unpublished; unexpected RPC status remains unpublished.

Commits:
- `4157ed77ee77e7efac0ebf3f45c883014dcfd543` - extract candidate promotion gate.
- `1ca9fc9ac71a86cc79715e31d871f5dbae38a231` - add promotion gate tests.
- `a63c10c302faf493adc904014d45becf03bb37bd` - wire the tested gate into the Edge Function.

Validation status:
- The Vercel checks for the two new test commits and the handler update have not yet been checked at the time of this document update.
- GitHub's commit-workflow-runs endpoint returned no workflow runs for the earlier tracked-brand commits; only Vercel status checks were visible. Do not interpret Vercel success as Deno/SQL CI success.
- The full mocked Edge Function request-flow test remains outstanding. The current handler is a single large `Deno.serve` closure with direct environment, fetch, and Supabase client dependencies. A safe end-to-end harness will require a deliberate handler/dependency-injection refactor rather than a brittle source-text test.
- No hosted sandbox or Production deployment was performed.

## Development update - 2026-11-17 (handler runtime injection)

Implemented on `feat/replace-rerun-data`:

- Extracted the Edge Function entry point into exported `createVisibilityTrackingHandler(dependencies)`. Production entry remains `Deno.serve(createVisibilityTrackingHandler())` when the module is the Deno main module.
- Added injectable environment lookup, HTTP fetch, and Supabase admin-client creation dependencies. Defaults preserve the existing Deno runtime behaviour.
- Routed authentication requests, primary provider requests, and entity-extraction requests through the injected fetch function. Secret lookup/decryption now accepts the injected environment lookup.
- Added handler-level tests for: emergency pause returning 503 before auth/fetch/database creation; OPTIONS preflight preceding the pause check; missing bearer token rejection before network/database work; and invalid bearer token rejection before database client creation.
- This is the first seam for a true request-flow harness, not yet the full mocked end-to-end test. The remaining challenge is a deterministic Supabase query-builder mock and fixture setup for access checks, prompt/configuration reads, raw response inserts, candidate staging, and final promotion.

Commits:
- `8ddb8bc5ae708e864bb5725442983825f445db38` - introduce injectable handler dependencies.
- `7a88e1d81cf4bf2c855f8501a0438920eeadb698` - route all provider requests through injected fetch.
- `ded06d3c0671474521df1f24fe4ca309960fb343` - add handler early-exit tests.
- `4d6e046901974b6971f77a9223c0317c4995294d` - harden auth request assertions.

Validation status:
- No Deno test, Deno check, or TypeScript CI result has yet been verified for these commits. Vercel checks are not a substitute for Edge Function CI.
- The complete mocked Edge Function request-flow test remains outstanding. No hosted sandbox or Production deployment was performed.

Additional handler-level authorization coverage:

- Added a lightweight Supabase query-builder fake for the three initial access lookups.
- Verified an authenticated project member with a non-admin role is denied persistent tracking before prompt reads or provider calls.
- Verified a user without project membership is denied sample access before prompt reads.
- These tests exercise the actual exported handler and its authorization branch, but do not yet execute prompt loading, candidate creation, raw-response persistence, six-table staging, or promotion.

Commit:
- `f70168cb75cbca37a87b8f21ad55324b01dc67a3` - test project authorization through the handler.


## Development update - 2026-11-17 (handler validation guard)

Implemented on `feat/replace-rerun-data`:

- Extended the scripted Supabase query fake so the actual Edge Function handler can be tested beyond the initial access checks.
- Added a request-flow test for an authenticated project Admin whose selected category has no tracked-brand assignment.
- The test verifies the handler rejects the request with `BRAND_REGISTRY_INCOMPLETE` before creating a `tracking_runs` row or making a provider request. This protects the replacement path from starting a candidate against invalid comparison configuration.
- This is still a focused handler test, not the full provider-to-promotion rehearsal.

Commit:
- `f3f2cba27b7018f8850cccdf610784cdc14d25ba` - test incomplete brand setup rejection through handler.

Validation status:
- The commit's combined GitHub status currently reports only a pending Vercel check. The workflow-runs lookup exposed no run, and no Deno test/type-check or database smoke-test result is confirmed. Do not treat the pending Vercel check as passing Edge Function or SQL validation.
- The feature branch is 131 commits ahead of `main`, 0 behind.
- No Supabase migration, Edge Function deployment, Vercel Production deployment, hosted sandbox, or historical deletion was performed.

Updated next steps:
1. Continue expanding the actual-handler harness through prompt/config reads, candidate creation, provider retry behaviour, raw response persistence, and staging calls.
2. Add explicit negative-path assertions that incomplete/failed candidates never invoke promotion and never modify the previously published scope.
3. Verify all Deno tests and `deno check`, then obtain a confirmed database smoke-test result from the isolated CI workflow.
4. Only after those checks, plan the isolated hosted Supabase rehearsal. Disclose any potential cost and obtain confirmation before creating a paid resource.
5. Keep Production migrations, Edge Function deployment, Vercel Production promotion, unpausing, and historical deletion gated behind separate explicit approval.


## Development update - 2026-11-17 (tracked-brand validation moved before execution)

A follow-up audit found that the read-only tracked-brand validator, although it prevented configuration writes, was still being called after provider processing and raw-response persistence. That meant invalid registry setup could consume API credits and leave a failed candidate run before the configuration problem was reported.

Corrected on `feat/replace-rerun-data`:

- Persistent tracking now loads the complete active brand registry and category assignments during preflight.
- The tracked-brand registry and per-category tracked-brand assignment are validated before the API secret is decrypted, before a `tracking_runs` row is created, and before any provider request.
- The same preloaded configuration is reused by the later evidence/mentions stage, avoiding a second read of mutable project configuration.
- Added a handler-level regression test with a valid tracked-brand assignment but a missing registry row. It asserts HTTP 409 with `TRACKED_BRAND_REGISTRY_INCOMPLETE`, zero tracking-run writes, and zero provider requests.

Commits:
- `6928bdf47575438ff5389b50589adc63e1567d01` - move tracked-brand preflight ahead of candidate execution.
- `325cad3c264c1fa4f09979241bafa581d1883935` - test missing registry rejection before provider calls.

Validation status:
- The latest combined commit status reports a pending Vercel check only. No Deno test/type-check or database smoke-test result is confirmed. No hosted or Production deployment was performed.


## Development update - 2026-11-17 (failed-provider lifecycle handler test)

Added a higher-coverage test through the exported `createVisibilityTrackingHandler`, using a scripted Supabase client and an AES-GCM encrypted test API secret.

The test executes the persistent category-run path with:
- an authenticated project Admin;
- a valid tracked-brand registry and category assignment;
- one selected active prompt;
- a provider response that fails immediately with HTTP 401.

It asserts that:
- the handler returns a failed run result;
- the provider is called exactly once (401 is not retryable);
- the raw response persistence path is reached;
- the candidate's `visibility_daily` data is staged for diagnostics;
- the run is finalized as failed;
- `promote_tracking_run_candidate` is never called;
- no table delete is issued by the handler.

Commit:
- `265e089c1edfaefb01b61a9c6c3607a679d5c3a3` - exercise failed provider candidate lifecycle through the handler.

Validation status:
- The commit's combined status currently reports a pending Vercel check. The repository workflow is configured to run Deno checks/tests and isolated local Supabase migration tests on branch pushes, but I have not yet obtained a confirmed workflow-run result for this commit.
- No Deno test, Deno check, or SQL behavioural test is claimed as passing.
- No hosted Supabase rehearsal, Production migration, Edge Function deployment, Vercel Production deployment, unpause, or historical deletion was performed.

Next development focus:
1. Add the complementary successful-provider path through the handler, including deterministic citation/evidence/mention staging and the promotion RPC boundary.
2. Extend the fake database to retain inserted response IDs and verify the staged response-linked data, not just the RPC invocation.
3. Obtain and inspect the branch-push CI run. Fix any TypeScript/Deno failures before proceeding to the successful lifecycle test.


## Development update - 2026-11-17 (successful-provider lifecycle and promotion-failure tests)

Added complementary request-flow coverage through the real exported Edge Function handler:

- The mocked provider returns a completed answer with a Lifewood citation and a web-search source.
- The second provider request performs entity extraction and returns a grounded Lifewood entity.
- The scripted Supabase client retains the inserted raw response and makes it available to the handler's subsequent response-ID lookup.
- The test asserts that all six candidate-derived tables are staged: `citations`, `citation_occurrences`, `response_brand_evidence`, `third_party_mentions`, `category_brand_observations`, and `visibility_daily`.
- It verifies the run is marked completed before the promotion RPC is called, and the handler reports publication only when the promotion RPC confirms `status = published`.
- A separate promotion-RPC-error scenario verifies the handler returns `CANDIDATE_PROMOTION_FAILED`, leaves the candidate `completed_unpublished`, and does not issue table deletes.

Commit:
- `e1c71926f4f785e93aa38f4d0ab403bc42169da9` - test successful candidate lifecycle and promotion failure through handler.

Validation status:
- The latest commit's combined status currently exposes only a pending Vercel check. This is not the replacement database/Deno workflow and does not establish that these new tests pass.
- The handler tests have been added but have not yet been executed in a confirmed Deno CI run. Do not treat the assertions as verified runtime results until the branch-push workflow completes.
- No hosted Supabase rehearsal, Production migration, Edge Function deployment, Vercel Production promotion, unpause, or historical deletion was performed.

Next steps:
1. Obtain the branch-push workflow result and inspect any failing job logs. Fix Deno/type/test failures before adding more handler scenarios.
2. If the successful lifecycle test passes, extend coverage for unexpected promotion status and provider retry exhaustion as useful.
3. Keep all hosted/Production actions behind the existing explicit approval gates.


Additional fail-closed coverage:
- Added a handler-level test where the promotion RPC returns an unexpected non-error status. The response remains `completed_unpublished` with HTTP 500; the handler does not claim publication or issue deletes.
- Commit: `8478b0be52247fd3cc095024f332fa6d4e2521c3` - test unexpected candidate promotion status fails closed.

The Deno/SQL workflow result remains unverified for these latest commits. The combined commit status still reports only a Vercel check, which is not the Edge Function or database test workflow.


Further strengthening of the successful lifecycle test:
- Asserted that each of the six candidate staging RPC calls contains a non-empty row payload, rather than merely checking that the table key was mentioned.
- Asserted raw `ai_responses` persistence occurs before candidate staging.
- Asserted every required staging call occurs before the promotion RPC, and that the tracking run is marked completed before promotion.
- Commit: `45b1a68b159f94484529c7015daede952055d6b3` - assert candidate staging contains rows before promotion.

These are source-level test additions only. The branch-push workflow still needs an observable successful run before the Deno and SQL behaviour suite can be considered verified.


Entity-analysis failure gate coverage:
- Extended the successful lifecycle fixture to simulate an HTTP 401 from the separate entity-extraction request.
- Added a handler test asserting that the provider response can be retained, but the run is finalized as `partial`, reports one analysis failure, and never calls candidate promotion.
- The test also asserts that no destructive table delete is issued.
- Commit: `593ceb83cdba8468656188c8ea3ba02f40ab58b2` - test entity extraction failure remains unpublished.

This covers another condition in the publication gate: a provider answer alone is insufficient for publication if required response analysis did not complete.


## Development update - 2026-11-17 (entity-extraction retry correction)

A review of the new handler lifecycle test exposed a mismatch between the entity-extraction retry comment and the actual catch behaviour: deterministic failures such as HTTP 401 were being retried because the catch block unconditionally continued after the first exception.

Corrected on `feat/replace-rerun-data`:

- Entity extraction now retries a network/timeout/abort failure once, then stops if the retry also fails.
- HTTP 429 and 5xx responses retain their existing bounded retry path.
- Authentication/validation errors, malformed extraction JSON, missing response IDs, and other deterministic failures now fail the extraction batch immediately.
- Updated the handler-level HTTP 401 regression test to assert exactly one extraction request instead of three. The run remains partial/unpublished and promotion is not called.

Commits:
- `f855856d900812fd9c21c45d42c037353ad756b7` - stop retrying deterministic entity extraction failures.
- `02d9d4717fbc800bde39c73583d5d036900f15bb` - assert extraction auth failure is not retried.

Validation status:
- The code and test changes are committed to the feature branch. They have not yet been executed in a confirmed Deno/SQL CI run.
- No hosted Supabase rehearsal, Production migration, Edge Function deployment, Vercel Production deployment, unpause, or historical deletion was performed.


Additional retry regression coverage:
- Extended the actual-handler lifecycle fixture to simulate one transient network failure during entity extraction.
- Added a test asserting the extraction request is retried once, the second request succeeds, and the completed candidate proceeds to promotion.
- Commit: `d79744bb43e15e5a0ce56303b36e953c31465915` - cover transient entity extraction retry.
- These tests are committed but still require a confirmed Deno CI execution; they are not yet claimed as passing.


A further hardening pass made HTTP failure handling explicit: non-retryable HTTP responses now set the batch error and break directly, rather than throwing into the network-exception classifier. This prevents provider-supplied error wording from accidentally matching the transient-network regex. HTTP 429/5xx retain their explicit retry branch; the network exception path remains limited to one retry.

Commit: `d6d6b3561cc7b09e7e73581b0695802af0f2e0a1` - fail fast on non-retryable extraction HTTP responses.


## Development update - 2026-11-17 (candidate raw-response scope validation)

The promotion audit found that the original candidate validator checked response counts and metric scope, but did not independently prove that every raw response belonged to the candidate's project/provider/prompt category. The handler normally constructs those fields correctly, but the database promotion gate must defend itself against malformed or inconsistent candidate data.

Added migration `20261117120000_harden_candidate_raw_response_scope_validation.sql`:

- Requires each candidate raw response's `project_id` to equal the candidate project.
- Requires each raw response's `llm_provider` to equal the candidate provider.
- Requires each response's prompt to exist, belong to the same project, and fall within the candidate category scope (or configured project categories for a full-run validation).
- Rejects null response tracking locations.
- Enforces the currently supported single configured project tracking location, requiring the candidate responses to match it and the run's primary location.
- Keeps validation read-only; it does not modify canonical data or predecessors.

Expanded `replacement_rerun_candidate_validation_behaviour.sql` with negative cases for wrong provider, wrong project, wrong prompt category, and an unconfigured second location. These cases assert the explicit validation errors rather than relying on the HTTP handler to prevent bad input.

Commits:
- `08aa428ad35d356a284c69df02a50106f1237949` - add raw-response scope validation migration.
- `4666c21cf061015beb8864ca971da0a5e5282141` - test provider and prompt category isolation.
- `aac1288f725a5edeecd18114b96f4fc39cdaf545` - test project isolation.
- `a37d6830e13131e6b918307b9e418082f2f1906c` - enforce single configured location.
- `34d05d255a9aa4155cf9e33bc775303f63816709` - test unconfigured location rejection.

Verification remains pending: these SQL behavioural tests have not yet been executed against a local disposable Supabase database or confirmed CI run. No hosted or Production resources were changed.


CI integration follow-up:
- Added the new hardening migration to `.github/workflows/replacement-rerun-db-tests.yml` after the existing 2026-11-17 coordination migration, preserving chronological application order.
- This ensures the disposable database behavioural suite actually exercises the new validator rather than testing only the earlier function definition.
- Commits: `501c74cd6300748445925d4e67fc0341820e168a` (include migration), `f1af618e3296d5585402f9308a655bb2f1e9579e` (chronological order).


## Development update - 2026-11-17 (staged brand ownership validation)

The replacement audit identified a remaining database validation gap: foreign keys prove that a referenced brand exists, but do not prove that the brand belongs to the candidate's project. A malformed staged row could otherwise associate a candidate response with a brand registry record from another project.

Added migration `20261117130000_validate_staged_brand_project_ownership.sql`:

- Validates `response_brand_evidence.brand_id`.
- Validates `category_brand_observations.brand_id`.
- Validates `citation_occurrences.entity_id`.
- Validates every ID in `third_party_mentions.associated_brand_ids`.
- Rejects missing, unknown, or foreign-project registry references with the explicit error `staged_brand_reference_not_owned_by_candidate_project`.
- Keeps validation read-only; canonical rows and predecessor runs are not modified.

Expanded `replacement_rerun_candidate_validation_behaviour.sql` with a negative case that stages a foreign-project brand across all four reference shapes and asserts that validation rejects the candidate.

Updated the disposable local database workflow to apply the new migration chronologically and include the expanded behavioural test. The runbook now lists ten reviewed migrations.

Commit:
- `7550552a414f82e2cce96807b74a47c1b185d38a` - validate staged brand project ownership.

Verification status:
- The migration and SQL regression test are committed, but no confirmed CI execution or local PostgreSQL run is available yet.
- No hosted Supabase rehearsal, Production migration, Edge Function deployment, Vercel Production deployment, unpause, or historical deletion was performed.


## Development update - 2026-11-17 (reduced derived-data replacement coverage)

Extended `replacement_rerun_derived_data_behaviour.sql` to cover a replacement candidate that contains fewer competitor observations and citation occurrences than its predecessor:

- The predecessor includes one configured competitor's category observation and citation occurrence.
- The replacement candidate deliberately omits that competitor's observation and citation occurrence.
- Assertions verify that the predecessor competitor evidence does not survive promotion, while the candidate's tracked-brand evidence remains.
- Existing assertions continue to verify that the legacy `competitors` sentinel and the separate `direct_competitors` configuration and `direct_competitor_observations` sentinel remain untouched.

This specifically guards against stale competitor rows remaining when a replacement has fewer derived observations, rather than only testing a one-for-one replacement.

Verification status:
- Regression coverage is committed to the disposable-database test suite.
- It has not yet been executed in a confirmed local PostgreSQL or GitHub Actions run.
- No hosted Supabase rehearsal, Production migration, Edge Function deployment, Vercel Production deployment, unpause, or historical deletion was performed.


## Development update - 2026-11-17 (Overall competitor and citation regression coverage)

Expanded `replacement_rerun_derived_data_behaviour.sql` to verify the Overall aggregate after a replacement that removes a predecessor competitor observation and citation occurrence:

- Overall citation count must equal the replacement category's citation count, and its `source_run_ids` must point to the replacement run.
- The predecessor competitor must not remain in Overall `category_brand_observations` when the replacement candidate omits it.
- The existing checks continue to prove that direct-competitor configuration and direct-competitor observations remain unchanged.

This tests the downstream pooled aggregate, not just the category-level replacement tables.

Verification status:
- Added to the disposable-database regression suite.
- The prior full workflow passed before this additional assertion; this latest assertion still needs a fresh CI run.
- No hosted Supabase rehearsal or Production deployment/migration has been performed.


## Development update - 2026-11-17 (multi-provider Overall preservation)

A review found that candidate promotion always asked the per-provider Overall builder to write the shared `Overall` provider row. On dates where more than one provider has a published category run, this could overwrite the cross-provider pool with a single-provider aggregate.

Added migration `20261117140000_rebuild_cross_provider_overall_after_replacement.sql`:

- Detects whether another provider has a completed, published category run for the same project, Malaysia date, and location.
- For single-provider dates, retains the existing per-provider Overall rebuild.
- For multi-provider dates, rebuilds the provider-specific aggregate without writing the shared `Overall` provider row, then rebuilds the shared pool through `publish_cross_engine_metrics`.
- If shared Overall category coverage is incomplete, invalidates only the shared Overall aggregate and its matching Overall rows. It does not supersede valid per-category cross-provider aggregates.

Added a synthetic multi-provider regression case with one Gemini run and a ChatGPT replacement. It asserts the shared Overall score, citation count, and source-run lineage pool both providers rather than reporting ChatGPT alone.

Verification status:
- The migration and regression test are committed to the feature branch.
- A fresh disposable-database CI run is required before considering this fix verified.
- No hosted Supabase rehearsal, Production migration, Edge Function deployment, Vercel Production deployment, unpause, or historical deletion was performed.

---

## Development update - 2026-11-17 (latest verified implementation state)

This section supersedes earlier verification notes in this document where they describe the same tests as pending. The latest branch state and workflow result are authoritative.

### Verified feature-branch state

- Branch: `feat/replace-rerun-data`
- Verified commit: `7eaad3c4bc2d7bd7e0ae666ac915abcbfa5bd3d8`
- GitHub Actions run: [44023851092](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44023851092)
- Workflow conclusion: **success**

The successful workflow covered:

- Application TypeScript check.
- Visibility-tracking Edge Function Deno check and unit tests.
- Disposable local Supabase schema restoration.
- All eleven replacement migrations applied in chronological order.
- RPC, staging access, and privilege contract checks.
- Candidate validation, including raw-response scope and project-owned brand references.
- First publication, exact-scope replacement, rollback, scope isolation, and source-run foreign-key behaviour.
- Overall rebuild/invalidation and run-owned derived-data replacement.
- Concurrent same-scope replacement.
- Multi-provider Overall aggregation, including shared ChatGPT/Gemini source-run lineage.

This is isolated disposable-database CI evidence only. It is not a hosted Supabase rehearsal and does not verify Production.

### Current implementation boundaries

- Candidate writes remain isolated from published date-grain derived tables until promotion.
- Promotion is gated on a completed candidate and the database validation/promotion RPC.
- Replacement is scoped to the exact supported project, Malaysia-local date, category, provider, and single configured tracking location.
- The shared Overall pool is rebuilt across providers when multiple providers have published runs for the same date/location.
- The emergency pause gate and tracked-brand configuration read-only validation remain in place.
- Direct competitor configuration and direct competitor observations are preserved by replacement.
- Full-run/multi-category atomic promotion and multi-location candidates remain unsupported.
- No Production migration, Edge Function deployment, Vercel Production deployment, unpause, hosted rerun, or historical deletion has occurred.

### Next-stage audit - competitor recomputation and historical compatibility

Reviewed the coordinated competitor recomputation function in `20261117110000_coordinate_competitor_recompute_with_tracking_replacements.sql`, its original implementation in `20261027090100_recompute_competitor_metrics_function.sql`, and the recompute queue/trigger migration.

Confirmed:

1. `recompute_competitor_metrics` and candidate promotion acquire the same project-scoped transaction advisory lock (`__TRACKING_REPLACEMENT_RECOMPUTE__`). This serializes a project's competitor recomputation against replacement promotion and prevents the worker from publishing an Overall snapshot from a concurrently changing replacement scope.
2. The recompute worker builds its units only from completed, published, non-superseded category runs for the requested project and optional Malaysia-local date range. It does not intentionally process unrelated projects or unpublished candidates.
3. Legacy all-category runs are handled through synthetic category slices only when the stored tracked-brand score can be reproduced from the source run's raw responses. The synthetic slice points to the original run through `source_run_id`.
4. Imported `profound_import` runs use stored tracked-brand response evidence rather than assuming the imported response text contains the brand name. This preserves the source's tracked-brand flag semantics.
5. The worker archives competitor observations that no longer belong to the current competitor set before removing those active observation rows. It does not delete the source `ai_responses`, competitor registry/configuration, or the separate direct-competitor registry/observations.
6. Competitor evidence and citation-occurrence rows for brands removed from the current competitor set are not comprehensively pruned by the recompute function. They remain attached to their source responses. This is currently treated as retained source-level evidence, not as proof that those brands remain active competitors; the active observation set is rebuilt separately. Before changing this behaviour, downstream consumers and historical audit expectations must be checked so that imported/source evidence is not destructively discarded.

### Remaining next-stage work

- [ ] Add explicit regression coverage for competitor recomputation against a synthetic legacy/imported dataset and a replacement-published dataset.
- [ ] Verify recompute queue retry/failure behaviour and confirm the shared lock is exercised in the test workflow.
- [ ] Trace every consumer of retained response evidence and citation occurrences to confirm that removed competitor evidence cannot leak into active leaderboards, citation summaries, or Overall metrics.
- [ ] Prepare a read-only historical lineage inventory covering project/date/category/provider/location, candidate predecessor IDs, source-run lineage, and row counts. Do not execute any historical deletion.
- [ ] Review the inventory output and obtain separate approval before any historical deletion.

No Production or hosted environment was changed during this audit.


### Competitor recomputation contract regression added

Added `supabase/tests/replacement_rerun_competitor_recompute_contract.sql` and wired it into the disposable-database workflow. It checks that:

- Replacement promotion and competitor recomputation retain the same project advisory-lock key.
- Recompute retains legacy `source_run_id` and `profound_import` handling.
- Removed active competitor observations are archived before removal.
- Recompute remains scoped to the requested project and active, non-superseded runs.
- Recompute does not delete raw AI responses or the separate direct-competitor configuration/observation tables.

This is a database-function contract test, not a substitute for the planned end-to-end synthetic legacy/imported-data fixture. It must pass in a fresh CI run before being treated as verified.


### End-to-end competitor recomputation fixture and historical inventory

Added `supabase/tests/replacement_rerun_competitor_recompute_behaviour.sql` and wired it into the disposable-database workflow. The fixture exercises:

- Imported Gemini run whose tracked-brand presence is represented by stored Profound evidence even though the tracked brand name is absent from response text.
- A Perplexity predecessor and replacement on the same project/category/date/provider/location, confirming only the active replacement is used for rebuilt observations.
- A removed competitor observation being archived before it disappears from active observations.
- Rebuilding competitor response evidence and citation occurrences from raw response annotations.
- A verifiable legacy ChatGPT full run being republished as a synthetic category run with `source_run_id` lineage.
- Canonical finalization of the synthetic, imported, and replacement-published units.

Also added `supabase/diagnostics/replacement_rerun_historical_inventory.sql`. It is a SELECT-only report that groups historical runs by project, Malaysia-local date, category, provider, and tracking location and reports run lineage plus raw response, evidence, citation occurrence, competitor observation, visibility metric, and replacement audit row counts. It does not modify or delete any records.

The new behavioural fixture must pass in CI before it is considered verified. The inventory query has not been run against hosted data; it is provided for a later, separately approved read-only review. No historical deletion is included.


### Active-run selection hardened for leaderboard consumers

The consumer audit traced the Leaderboards page through `lib/leaderboard.ts`. It loads category competitor observations and tracked-brand metrics, then filters both by the run IDs returned from `get_published_run_ids_for_leaderboard`.

The existing lookup selected the newest completed/published run by timestamp but did not explicitly exclude `superseded_at IS NOT NULL`. Replacement publication normally gives the new run the newer timestamp, but explicit active-run filtering is the correct invariant and protects against backfilled/imported timestamps.

Added migration `20261117150000_exclude_superseded_runs_from_leaderboard_lookup.sql` to patch the lookup so superseded runs cannot be selected. Added a contract assertion and included the migration in the disposable database workflow.

Also corrected the read-only inventory query to use the actual audit column `replaced_run_id` and distinct counts where source-run lineage can otherwise duplicate response/evidence joins.

Verification is pending the next fresh CI run. No Production migration or hosted query was executed.


### Competitor recomputation fixture - first CI finding

The first end-to-end fixture run failed at the imported Gemini observation assertion. The recomputation worker intentionally selects the latest completed response per prompt, so the initial fixture incorrectly attached two imported responses to the same prompt ID. That caused the worker to treat them as one response. The fixture now uses two distinct prompt IDs, matching the real tracking/import data model. This was a test-fixture correction, not a production-code change.

The failing run was `44026470833`; application and Edge checks passed, and the database suite reached the new behavioural test. The corrected fixture and active-run lookup migration are being re-run together.


The read-only inventory query is now also executed by the disposable database workflow as a syntax/schema compatibility check. The CI check runs against the empty schema fixture only; it does not inspect hosted historical records.


### Verified historical recomputation and active-run lookup

The complete workflow passed on commit `6205e9701992efd8b7e53c3ff5d15e353ccf9c33`:
[GitHub Actions run 44027055471](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44027055471)

This included:
- Application type-check and Edge Function checks/tests.
- All replacement migrations, including the new active-run lookup patch.
- The imported/legacy/replacement competitor recomputation behavioural fixture.
- All existing replacement, rollback, isolation, Overall, source-FK, and concurrency tests.
- Execution of the read-only historical inventory SQL against the disposable schema.

### Consumer audit findings

- The Leaderboards page reads `category_brand_observations` and `visibility_daily`, then filters rows against run IDs returned by `get_published_run_ids_for_leaderboard`. That lookup now explicitly excludes superseded runs.
- The Citations page reads the aggregated `citations` table through `get_cumulative_citations`; the replacement promotion path owns exact-scope replacement of those aggregate rows.
- The third-party citation page reads `third_party_mentions`; replacement promotion also owns exact-scope replacement of those rows.
- The pages inspected do not directly consume retained `response_brand_evidence` or `citation_occurrences` as active leaderboard rows. Those remain source/derived evidence for recomputation and attribution; active competitor rankings are based on run-scoped category observations.

### Recompute queue failure and retry coverage

Added a deterministic worker-failure scenario to the competitor recomputation behavioural fixture. It injects a transaction-local test trigger to force the queue worker to fail, verifies the job is marked `failed` with the error retained, then explicitly re-enqueues the project and verifies the fresh job completes after the injected failure is removed.

The current queue design does not automatically retry a failed job. It preserves the failed job for audit and allows a new job to be enqueued by a subsequent competitor change or manual recompute request. This fixture verifies that explicit retry path. The new queue test requires a fresh CI run.


### Production schema preflight for the historical inventory

The connected Supabase project was confirmed as `lifewood-ai-visibility` (`jhauufmrxpsbfrahgclv`), ACTIVE_HEALTHY. The applied migration list currently ends at the November 12 report-template migrations; the replacement audit migration has not been applied there.

A read-only `information_schema.columns` check confirmed the existing Production columns needed for run lineage, raw responses, response evidence, normalized citation occurrences, visibility metrics, competitor observations, and direct competitor records. It also confirmed that `tracking_run_replacements` is not yet present. The inventory query now reports its audit count as NULL (not zero) until that table exists, avoiding any assumption that the pending replacement migration has been deployed.

The hosted inventory itself remains a SELECT-only operation. No schema changes, row updates, deletes, or deployments were performed during this preflight.


### Historical inventory query refined after Production read-only review

The first hosted inventory execution revealed that grouping all run kinds together obscures the distinction between legacy `full` source runs, category-level `category` runs, and `overall_aggregate` records. The diagnostic is now grouped by `run_kind` and reports completed-but-unpublished runs separately.

For synthetic category slices, raw-response and evidence counts now filter the source run's responses by the prompt's category. This avoids counting every response from a shared legacy full run in every synthetic category slice. The query still makes no changes and treats the not-yet-deployed replacement audit table as unavailable rather than reporting a misleading zero.


The live inventory exposed a historical data-model nuance: some legacy full-run source responses have `prompt_id IS NULL` after the historical prompt reset. The diagnostic now distinguishes shared source-run raw response rows from the subset still linked to category prompts, and counts retained response evidence by its own category field. This prevents reporting zero source responses solely because the prompt foreign keys were cleared.


### Queue failure/retry test passed

The queue failure/retry fixture passed in GitHub Actions run `44027361771` on commit `c48b8f3ba096fd81fc3cfcdac615f41bf116ac78`. The test forces a recomputation exception, verifies the job is retained as failed with its error, then explicitly enqueues a new job and verifies successful completion.

### Historical inventory expanded to include incomplete runs

The live read-only inventory showed Dr D Signature Clinic has historical failed and partial runs in addition to published and completed-unpublished runs. The diagnostic now includes every run status for `category`, `full`, and `overall_aggregate`, and reports failed, partial, in-progress, superseded, and completed-unpublished IDs separately. Citation occurrence counts are now restricted to the current run or its source-run lineage rather than every occurrence in the same scope.

This is important for cleanup planning: a failed or partial run is not a published predecessor, and a completed-unpublished legacy full run may still be the source of category-level synthetic slices. No deletion is authorised or performed.


### Production historical inventory and foreign-key review

A read-only historical inventory was executed against the connected Production Supabase project. The result includes two projects: Dr D Signature Clinic and Lifewood. No data was modified.

The Dr D history contains:
- 130 category runs: 93 active published, 26 superseded published, 5 failed, and 6 partial.
- 25 legacy full runs: 8 completed-unpublished source runs, 15 failed, and 2 partial.
- 42 Overall aggregate runs: 31 active published and 11 superseded published.
- 18 synthetic category slices linked to 8 completed legacy full source runs.
- Failed and partial runs still have raw responses; they are not published predecessors and must not be treated as replacement targets.
- The 8 completed-unpublished full source runs must be preserved while the 18 synthetic category slices retain their `source_run_id` references.

The Lifewood history contains 4 active published category runs and 1 active published Overall aggregate, with no superseded or legacy full runs in the inventory window.

The Production foreign-key review confirmed:
- `tracking_runs.source_run_id` references `tracking_runs.id` with **NO ACTION** on delete. Source runs cannot be deleted while synthetic category slices still reference them.
- `tracking_runs.supersedes_run_id`, `category_brand_observations.run_id`, `visibility_daily.run_id`, and `tracking_batch_categories.tracking_run_id` use **SET NULL**.
- `tracking_run_daily_claims.run_id` and `tracking_run_stages.run_id` use **CASCADE**.

Added a reusable read-only FK diagnostic and included it in CI. The live Production result and individual run IDs are not written into the repository. No historical deletion, migration, Edge Function deployment, or application deployment was performed.


### Per-run historical dependency detail added

Added `supabase/diagnostics/replacement_rerun_run_dependency_detail.sql`, a read-only report for:
- Superseded published runs.
- Completed-unpublished legacy full source runs.
- Failed and partial unpublished runs.

For each run it reports direct and source-shared raw response counts, response evidence, citation occurrences, third-party mentions, run-owned competitor and visibility rows, source/supersedes child references, stage rows, daily claims, batch-category references, and the not-yet-deployed replacement audit count. The query is included in CI for schema validation. It has not yet been executed against Production.


### Per-run dependency audit verified

The latest full feature-branch workflow passed on commit `a12fba1aee51c9fdea09a238a464d3df22ab8508`:
[GitHub Actions run 44029030755](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44029030755)

All checks passed, including the new queue failure/retry fixture, imported/legacy/replacement competitor recomputation fixture, the historical inventory query, the tracking-run FK inventory query, and the per-run dependency query.

The per-run dependency query was also executed read-only against the connected Production database. It confirmed:
- Superseded published category runs still retain their raw responses, response-brand evidence, run-stage rows, and batch-category references, while active competitor observations and visibility metrics point to the current runs.
- Superseded aggregate runs have no raw-response/evidence payload, but replacement-chain references remain.
- Completed-unpublished legacy full runs are still parents of synthetic category slices and must be retained while those `source_run_id` references exist.
- Failed and partial candidate runs remain unpublished; their `supersedes_run_id` fields point to still-active published predecessors. They must not be mistaken for published predecessors or allowed to displace them.
- The Production replacement-audit table is not deployed yet. Deleting historical superseded rows before that audit mechanism exists would lose predecessor-to-successor lineage because the live `supersedes_run_id` FK is `ON DELETE SET NULL`.

No Production data or schema was changed. No historical rows were deleted. The next safe step is to prepare the deployment and historical cleanup decision pack, with separate approvals for Production migrations/deployment and any historical deletion.


### Release decision pack updated

Updated `docs/REPLACEMENT_RERUN_DEPLOYMENT_RUNBOOK.md` to include the twelfth migration, `20261117150000_exclude_superseded_runs_from_leaderboard_lookup.sql`, and to record the current Production preflight state. The runbook now distinguishes the read-only checks already completed (migration history, key columns, FK dependencies, historical run inventory) from remaining release checks (triggers, grants, RLS, and hosted function definitions).

The Production migration history currently ends at the November 12, 2026 report-template migrations, so all twelve replacement migrations remain pending. The runbook remains **prepared, not executed**. A separate sandbox rehearsal and explicit approval for each Production deployment surface remain mandatory.


### Zero-cost rehearsal decision recorded

The user has explicitly ruled out additional Supabase spending. The implementation will not create a Supabase development branch, create another hosted Supabase project, upgrade a plan, or request organisation-level cost confirmation.

The next validation work will continue in the disposable local Supabase stack used by GitHub Actions. The latest successful run on commit `83c3a48e2d992f23eb275e0c4476c95f62efd614` applied the replacement migrations to a schema-only fixture and passed the replacement, rollback, isolation, aggregation, derived-data, FK, and concurrency behavioural tests.

This is not equivalent to a hosted integration rehearsal. The hosted Edge Function deployment, hosted database configuration, and live Vercel-to-Supabase flow remain unverified. Production must not be used as a substitute test environment. Any later Production release decision must explicitly acknowledge this remaining limitation and require separate approval for each deployment surface.

The deployment runbook now records this no-additional-cost constraint and the local-CI-only validation path.


### Draft review PR opened; no-cost preview validation started

Opened draft PR [#99](https://github.com/Yazito21/lifewood-ai-visibility/pull/99) from `feat/replace-rerun-data` to `main`. It is intentionally a draft and has not been merged.

Vercel's GitHub integration created a Preview deployment for the PR commit. At the latest check it was still **Building**. The preview URL is:
`https://lifewood-ai-visibility-git-feat-repla-77b243-yazito21s-projects.vercel.app`

The preview must be treated as frontend/build validation only until its Supabase environment is independently confirmed to be isolated and no-cost. Do not trigger tracking runs or mutate records through it while that is unknown. The deployment runbook has been clarified accordingly.

The PR explicitly records that no additional Supabase spend is authorised, that hosted rehearsal is deferred, and that Production deployment/data cleanup are not authorised by the PR.


### Category terminology standardisation

The persisted `tracking_runs.run_kind` value for a single-category run is standardised as `category`. Existing rows previously stored as `topic` are converted by migration `20261117160000_standardise_category_run_kind.sql`. The legacy `tracking_run_stages.metadata` JSON key `topic` is retained for backward compatibility when reading historical stage journals; it is not the `run_kind` value.


### Category terminology migration and regression coverage

Added migration `20261117160000_standardise_category_run_kind.sql` as the thirteenth replacement migration. It updates the legacy publication trigger and existing SQL functions before converting stored `tracking_runs.run_kind = 'topic'` values to `category`, then replaces the allowed-value constraint. The legacy stage-journal JSON metadata key `topic` is deliberately retained for historical compatibility. The Edge Function, promotion/recompute SQL, diagnostics, behavioural fixtures, schema contract, and deployment runbook now use `category` as the run-kind terminology. CI applies the new migration after the existing replacement migrations and asserts that no legacy `topic` run-kind values remain.

## 2026-11-17 progress update: terminology migration and full CI validation passed

**Current branch:** `feat/replace-rerun-data`  
**Current commit:** `8f2158df637b23e5f9f9822c26eed1c0ba8b3a72`  
**Review PR:** [#99](https://github.com/Yazito21/lifewood-ai-visibility/pull/99)  
**PR status:** Open, draft, not merged.

### Category terminology correction

The user clarified that the earlier change from "topic" to "category" was intended as a terminology-only standardisation. The replacement implementation was audited and corrected so the persisted `tracking_runs.run_kind` for a single configured category is `category`, not `topic`.

Added the thirteenth migration:

`supabase/migrations/20261117160000_standardise_category_run_kind.sql`

It:
- Updates existing SQL functions/publication-trigger logic that assign or check the legacy `topic` run kind.
- Converts existing `tracking_runs.run_kind = 'topic'` rows to `category`.
- Replaces the allowed-value constraint with `category`, `full`, and `overall_aggregate`.
- Preserves `full` and `overall_aggregate` semantics.
- Retains the historical `tracking_run_stages.metadata` JSON key `topic` for compatibility; this is not a run-kind value and is intentionally not renamed.

The Edge Function, promotion/recomputation SQL, diagnostics, behavioural fixtures, schema contract and runbook were updated to use category terminology.

### Latest automated validation

GitHub Actions completed successfully for commit `8f2158df637b23e5f9f9822c26eed1c0ba8b3a72`:

- [Replacement Rerun Database Smoke Tests](https://github.com/Yazito21/lifewood-ai-visibility/actions/runs/44048850962) — passed.
- Application type-check — passed.
- Edge Function type-check and unit tests — passed.
- Build Check — passed.
- Replacement database suite — passed, including the legacy run-kind conversion fixture, migration/schema contracts, candidate validation, first publication, exact-scope replacement, forced rollback, scope isolation, Overall aggregation, derived-data replacement, source-run FK rejection, concurrency, and read-only inventory query validation.
- Vercel Preview deployment — Ready for this commit. This is a Preview deployment, not a Production deployment.

### Current release position

The implementation and automated regression suite are ready for final review, but the feature is **not yet complete in Production**.

- PR #99 remains a draft and has not been merged.
- No additional Supabase spending is authorised. No hosted Supabase branch or extra project will be created.
- Local disposable Supabase CI is the validated zero-additional-cost test environment. It is not equivalent to a hosted end-to-end rehearsal.
- Hosted Supabase integration and the live Vercel-to-Supabase flow remain unverified.
- Production database migrations have not been applied.
- The `visibility-tracking` Edge Function has not been deployed to Production as part of this release.
- No Production historical data has been deleted or modified.
- The Vercel Preview must not be used to trigger tracking or mutate data unless its Supabase environment is independently confirmed to be safe and isolated.

### Remaining stages

1. Complete the final code and migration review; then mark PR #99 ready and merge only after review.
2. Perform Production release preflight: reconcile the exact pending migration list, verify live schema/function/trigger/grant/RLS assumptions, confirm a recovery point, and review deployment/rollback steps. Hosted rehearsal remains unavailable under the no-additional-cost constraint and must be disclosed.
3. Obtain explicit approval for the exact Production database migrations, Edge Function deployment, and Vercel Production deployment. These are not authorised by this progress update.
4. Deploy in the approved order, keep the replacement pause gate enabled during rollout, and verify deployment health before enabling replacement tracking.
5. After separate approval, perform controlled Production verification of successful replacement, failed/incomplete reruns, retries, rollback, category/project/provider/date/location isolation, competitor recomputation, Overall aggregation, Dashboard and run-history consistency.
6. Historical predecessor cleanup remains a separate decision and requires a read-only inventory review plus separate explicit approval. Do not infer approval from approval to deploy the replacement workflow.

**Safety status:** No Production changes or historical deletion have been performed. The implementation is CI-validated on the feature branch; Production rollout and live operational verification remain outstanding.


## 2026-11-18: final validation hardening and location-scoped recomputation correction

Commits:
- `ddc9e833065370ab2fcfb420ab3ce8af3afe9a29` — restrict the Overall publisher RPC to service role.
- `a261358007d065fdae13626b588f4a676e8929ef` — add RPC privilege/security contract assertions.
- `ccb5e69f55e7446e4aac80f53016e0b205a749c2` — pin the Overall publisher search path to `public, pg_temp`.
- `6e0dd1cf5a5d40c7c400a098b341869adf894b86` — preserve location-scoped presence counts in replacement recomputation functions.
- `81923fced9db77871d1701dd4ea6d7e3a4048016` — add regression assertions for location-scoped presence calls.

### Findings and changes

- The new `publish_engine_overall_metrics(uuid,date,text,text,boolean)` function is `SECURITY DEFINER`; its direct execution is revoked from `PUBLIC`, `anon`, and `authenticated`, and granted to `service_role` only.
- The function now pins `search_path` to `public, pg_temp`.
- A final migration-order review found that the later replacement/recompute migration redefined functions after the earlier location-scoping migration. Those later definitions had reintroduced two-argument `run_tracked_presence` calls in location-aware paths.
- Updated the replacement/recompute migration to pass the explicit location when rebuilding Overall metrics and when checking legacy full-run slices.
- Extended the schema contract to assert the location-specific helper calls remain in the final installed function definitions. This guards against future migration-order regressions.

### Validation evidence

For commit `81923fced9db77871d1701dd4ea6d7e3a4048016`, GitHub Actions reports:
- Replacement Rerun Database Smoke Tests: **passed**.
- Build Check: **passed**.
- Edge Function Check: **passed**.

The database suite uses a disposable local Supabase stack in GitHub Actions. It covers migration application, RPC/security contracts, candidate validation, first publication, exact-scope replacement, forced mid-promotion rollback, scope isolation, Overall aggregation/invalidation, run-owned derived-data replacement, source-run foreign-key rejection, concurrent same-scope replacement, and read-only historical inventory queries.

### Current stage and remaining gates

- [x] Candidate staging, validation, and transactional promotion implementation.
- [x] Edge Function candidate-write routing and deferred publication.
- [x] Exact-scope replacement, rollback, isolation, and recomputation behavioural tests.
- [x] RPC privilege and fixed-search-path contract checks.
- [x] Location-scoped Overall/recompute helper regression correction and test.
- [ ] Complete the remaining source-level review of all migration patches, Edge Function finalisation/error paths, and application read paths.
- [ ] Complete read-only Production preflight comparison of migration history, deployed definitions, grants, triggers, RLS, and recovery readiness.
- [ ] Hosted end-to-end rehearsal remains unavailable under the no-additional-cost Supabase constraint. Local CI is not a substitute for hosted integration verification.
- [ ] Obtain separate explicit approval before any Production migration, Edge Function deployment, Vercel Production deployment, unpausing tracking, or historical data deletion.

PR #99 remains open and in draft. No Production schema/data changes, hosted Supabase resources, deployments, or historical deletions have been performed.
