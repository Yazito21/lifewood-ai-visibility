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

The Edge Function emits an additional `Overall` visibility row for full-run candidates, alongside the topic/category rows. The validation gate is intended to validate topic/category coverage; Overall is a derived aggregate and is recalculated after category publication. The coverage query now excludes `category = 'Overall'` when comparing staged visibility rows to the project's configured categories. It still requires provider-specific rows for every expected category/location pair.

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

However, the existing `publish_engine_overall_metrics` function selects published `run_kind = 'topic'` runs only. A full candidate's daily rows are associated with a `run_kind = 'full'` run, so the promotion design must not assume that simply publishing a full run will make it eligible for the existing topic-based Overall aggregation. Existing full-run category slicing/backfill logic must be understood and the replacement transaction must define whether it creates topic slices, uses a dedicated full-run aggregate path, or rejects full-run promotion until supported.

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
4. [ ] Decide and test category-only promotion first versus full-run promotion with topic-slice semantics.
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

The Edge Function still supports a full Superadmin request with `tracking_runs.category = null` and `run_kind = 'full'`. The dashboard's standard category batch is a sequence of topic/category runs. The existing Overall aggregation functions select `run_kind = 'topic'` members, so full-run publication cannot be treated as equivalent to a batch of topic runs without an explicit conversion/slicing strategy.

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

The first category in the batch (ordinal 0) obtains the daily entitlement using `claim_daily_tracking_run`, then updates that newly created run with the actual category and first tracking location. This is necessary because the legacy claim RPC creates a category-null run by default; without the scope update, the first category would be treated as a full run. Later categories create their own topic-scoped run rows.

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
- First category creates a category-scoped `topic` run while claiming the daily entitlement.
- Second and later categories are accepted only after the prior batch category is marked completed and linked to a completed run.
- Failed categories do not permit the next ordinal to start.
- Batch ownership and project scope are enforced.
- A failed first-category claim or scope update does not leave an incorrectly scoped candidate behind.

No Production migrations, Edge Function deployments, candidate promotions, or historical deletions were performed.
