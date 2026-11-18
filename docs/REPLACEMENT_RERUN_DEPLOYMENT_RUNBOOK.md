# Replacement Rerun Deployment and Rollback Runbook

**Status: Prepared, not executed.**  
**Target Supabase project:** `jhauufmrxpsbfrahgclv`  
**Repository:** `Yazito21/lifewood-ai-visibility`  
**Feature branch:** `feat/replace-rerun-data`

This runbook is a controlled release plan only. It does not authorize Production deployment, migration application, historical deletion, or a live rerun.

## 1. Release scope

The replacement-rerun branch changes three deployment surfaces:

1. **Supabase database:** fourteen migrations listed below.
2. **Supabase Edge Function:** `visibility-tracking`, including candidate staging, atomic promotion, and the emergency pause gate.
3. **Vercel application:** `app/platform/[projectId]/dashboard/page.tsx`, which runs and resumes category batches and retains failed candidate IDs.

The branch also adds CI fixtures/tests and this operational documentation. No other Edge Function is in the intended release scope. The local-only `[db.migrations]` configuration used by CI must not be treated as a hosted database setting; see [Supabase CLI configuration](https://supabase.com/docs/guides/local-development/cli/config).

## 2. Preconditions and release blockers

Do not begin a hosted release until all of the following are satisfied:

- **Cost constraint:** do not create a Supabase development branch or additional Supabase project for this work. No Supabase spend is authorised. Use the disposable local Supabase stack in GitHub Actions for continued database and Edge Function integration testing. A hosted rehearsal is therefore deferred, not silently treated as passed. This remains a release limitation and must be disclosed in any Production decision.
- Handler-level mocked lifecycle tests now cover provider failures, entity-extraction failures/retries, raw response persistence, all six candidate staging tables, promotion success/failure, and fail-closed promotion responses. The tests are committed but must pass in CI before any hosted rehearsal.
- The tracked-brand registry bootstrap write side effect has been removed. Tracking now performs a read-only registry/category-assignment preflight and fails before provider calls or run creation when configuration is incomplete.
- A fresh read-only audit confirms the live schema, triggers, foreign keys, grants, RLS, function definitions, and migration history still match the assumptions in the implementation. The read-only Production preflight has confirmed the migration history, required columns, and tracking-run foreign keys; the remaining trigger/grant/RLS/function-definition checks are still release preconditions.
- Before the first live replacement, an independent backup/export checkpoint has been created and successfully restore-tested, and the operational owner is available during the release. The connected organization is on Supabase Free, so do not assume automatic daily backups or PITR. Follow [the Free-plan backup checklist](./REPLACEMENT_RERUN_FREE_PLAN_BACKUP_CHECKLIST.md): create a local logical export, retain an encrypted off-site copy, and restore it into an isolated local environment. This checkpoint has **not** yet been completed. Until it is verified, the Production replacement gate remains blocked unless the user separately accepts the unrecoverable-predecessor-payload risk.
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
13. `20261117160000_standardise_category_run_kind.sql`
14. `20261118100000_harden_metric_finalization_search_path.sql`

These migrations add candidate staging/audit structures and define or update the validation, preview, promotion, metric-finalization, recompute-coordination, cross-provider Overall rebuild, and active published-run lookup functions. The final migration ensures superseded runs are not selected as current leaderboard data. They do not authorize historical cleanup. Do not manually delete rows from canonical metric tables or legacy competitor tables as part of this release.

## 4. Controlled rollout sequence

### A. Preflight

1. Confirm the release commit SHA and that both CI jobs are green.
2. Confirm the completed logical export, encrypted off-site copy, and successful isolated restore test recorded under [the Free-plan backup checklist](./REPLACEMENT_RERUN_FREE_PLAN_BACKUP_CHECKLIST.md). Do not treat the replacement audit table as a backup. Do not assume Free-plan automatic backups or PITR.
3. Re-run the live read-only schema/function/trigger/FK audit and compare the remote migration history.
4. Confirm the exact migration list to be applied. Stop on any unexpected pending migration.
5. If a no-additional-cost hosted sandbox already exists, confirm it is isolated from Production data and credentials. Do not create or pay for one. If none exists, record hosted rehearsal as not performed and keep the Production release blocked unless a separate release decision explicitly accepts that limitation.

### B. Deploy the Edge Function in paused mode

1. Set the Edge Function secret `TRACKING_REPLACEMENT_PAUSED=true` on the target environment.
2. Deploy only `visibility-tracking` from the reviewed release commit.
3. Verify a request returns HTTP 503 with `TRACKING_TEMPORARILY_PAUSED` before it creates a run or writes to the database.
4. Do not unpause yet.

The pause gate is checked before authentication, database access, run creation, provider calls, candidate staging, or promotion.

### C. Apply database migrations

1. Apply the fourteen migrations in the order above using the approved migration procedure.
2. Re-run the schema/security contract and read-only function-definition checks against the hosted target.
3. Confirm the promotion RPC, candidate staging RPC, validation/preview RPCs, and advisory-lock coordination are present with the intended service-role-only grants.
4. Stop if any migration or post-migration contract check fails. Keep tracking paused.

### D. Deploy the Vercel application

1. Create/review the pull request from `feat/replace-rerun-data`.
2. Verify that the Vercel Preview build completes against the same release commit.
3. Do not use the Preview UI to run tracking or mutate data unless its Supabase environment is independently verified as an isolated, no-additional-cost sandbox. A Preview deployment alone does not establish backend isolation or replace hosted integration testing.
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
6. If canonical data is found to be incorrect, stop and prepare a separate, scope-specific recovery plan from the verified independent export/backup checkpoint. Do not delete or restore historical Production rows without explicit approval.
7. Re-enable tracking only after the corrected code and database contracts pass the required checks.

The pause secret is an operational stop control, not a substitute for database backups or a tested recovery plan.

## 6. Current Production preflight findings

The connected Production project is active and healthy. Its applied migration history currently ends at the November 12, 2026 report-template migrations; none of the fourteen replacement migrations above has been applied. The replacement audit table is therefore not present in Production. The live read-only inventory also confirmed legacy source-run dependencies and failed/partial unpublished attempts that must be retained unless a separate historical cleanup plan is approved.

No Production schema or data changes were made during the preflight. This section is informational and does not authorize a release.

## 7. Zero-additional-cost execution path

The user has explicitly instructed that no money is to be spent on Supabase for this implementation. This is a hard constraint:

- Do not create a Supabase development branch; branch creation can incur hourly compute charges.
- Do not create another hosted Supabase project or upgrade a plan.
- Do not request an organisation ID or run a Supabase branch/project cost-confirmation flow.
- Continue using the disposable local Supabase database created inside GitHub Actions. The latest successful run applied the replacement migrations to a schema-only local fixture and passed behavioural tests for first publication, exact-scope replacement, forced mid-promotion rollback, scope isolation, Overall aggregation, derived-data replacement, source-run FK rejection, and concurrent same-scope replacement.
- Treat local CI as strong database-contract and behavioural evidence, **not** as a hosted rehearsal. Hosted configuration, deployed Edge Function behaviour, real Production integration, and live Vercel-to-Supabase interactions remain unverified by this path.
- Do not compensate for the missing hosted rehearsal by using Production as a test environment. Production remains read-only until the user separately approves an appropriately controlled release with the limitation explicitly acknowledged.

The next no-cost work is continued local CI coverage, code review, runbook hardening, and (where available without additional charges) Vercel Preview validation. No paid Supabase resource is required for those activities.

## 8. Explicitly out of scope

- No Production migration, Edge Function deployment, or Vercel Production deployment has been performed by preparing this runbook.
- A read-only Production historical predecessor/dependency inventory has been performed. No historical rows have been deleted.
- No legacy `competitors`, `direct_competitors`, or `direct_competitor_observations` data is to be deleted.
- No Dr D Signature Clinic, MDLand, or unrelated project is to be modified or used for testing.


### Category run-kind terminology migration

The release now includes migration `20261117160000_standardise_category_run_kind.sql` as the thirteenth migration. It converts existing `tracking_runs.run_kind = 'topic'` values to `category`, updates the allowed-value constraint and updates existing SQL functions that branch on the legacy run kind. The historical stage-journal JSON key `topic` remains readable for compatibility.


### SECURITY DEFINER metric finalization search_path hardening

The fourteenth migration, `20261118100000_harden_metric_finalization_search_path.sql`, fixes the `search_path` for `public.run_tracked_presence(uuid, text, text)` and `public.finalize_run_metrics(uuid)` to `public, pg_temp`. These helpers participate in the replacement publication/finalization path. The migration is additive and does not modify application data. It must be included in the exact reviewed release set and in post-migration security verification.

### Latest feature-branch validation checkpoint

The current PR head is `3c6e01faf8c35d0600e277f6a026ecbe15164e24`. GitHub Actions reports success for all three workflows on that exact commit: Edge Function Check, Build Check, and Replacement Rerun Database Smoke Tests. This is local-CI validation only; it does not change the hosted-rehearsal limitation or authorize Production changes.


### Predecessor data retention and recovery checkpoint

The `tracking_run_replacements` table is a durable audit trail, **not a backup archive**. It records predecessor/replacement run metadata snapshots and deleted-row counts. The promotion transaction removes predecessor raw `ai_responses` and related derived rows after writing the audit record. Failed promotion transactions roll back atomically; after a successful commit, the audit record alone cannot restore the deleted raw response payloads or derived rows.

Before the first Production replacement, verify and record an independent backup/restore or export checkpoint for the exact replacement scope, or obtain explicit acceptance that predecessor payloads will not be recoverable from the replacement audit. Do not describe the audit table as a rollback mechanism. No Production backup, export, or data modification was performed by preparing this runbook.


## 9. Free-plan backup and restore gate (2026-11-18)

The connected Supabase organization reports the **Free** plan. The target project is active/healthy, but no automatic daily backup or PITR recovery point has been verified. No manual export or restore test has been executed as part of this work.

Use [`REPLACEMENT_RERUN_FREE_PLAN_BACKUP_CHECKLIST.md`](./REPLACEMENT_RERUN_FREE_PLAN_BACKUP_CHECKLIST.md) for the no-additional-Supabase-cost procedure. The operator must run the Supabase CLI export locally using the database connection string from the Supabase Dashboard. Never paste credentials or database dumps into ChatGPT, GitHub, or source control. The procedure requires a non-empty roles/schema/data export, SHA-256 manifest, encrypted off-site copy, isolated local restore, and row-count verification for replacement-critical tables.

**Release gate:** Do not perform the first Production replacement until the export and restore test have been verified and recorded, or the user separately accepts that successfully replaced predecessor payloads cannot be recovered from the replacement audit. The audit table stores metadata and deleted-row counts, not raw predecessor payloads.

No paid plan, PITR add-on, hosted branch, or additional Supabase project is authorised or required for this checklist.

## 10. Latest validation checkpoint (2026-11-18)

Latest feature-branch head: `978788980a096e75c24a3d8794703d9a7d393041`.

All three GitHub Actions workflows passed on this documentation-only head:
- Edge Function Check: run 44231135078.
- Build Check: run 44231135131.
- Replacement Rerun Database Smoke Tests: run 44231135102.

The Vercel Preview status check for this head reports success. Preview readiness does not prove backend isolation and does not replace hosted Supabase rehearsal.

The connected Production migration history still ends at `20261112032011`; none of the fourteen replacement migrations has been applied. The read-only Supabase advisors reported security/performance warnings requiring object-specific triage. No remediation was applied. PR #99 remains open, draft, and unmerged, with no human review recorded.

Hosted rehearsal remains unperformed under the no-additional-cost constraint. If an already-existing isolated environment is not available, keep this as an explicit release limitation; do not use Production or an unrelated client project as a test target.

No Production migrations, Edge Function or Vercel Production deployments, tracking activation, historical deletion, Supabase paid resource creation, or Production data changes have occurred.


## 11. Read-only advisor triage baseline (2026-11-18)

The latest Supabase advisor checks surfaced baseline warnings. A read-only SQL check confirmed that the seven RLS-enabled/no-policy tables have no `SELECT` grant for `anon` or `authenticated`. Six have a service-role SELECT grant; `prompts_backup_20261101` does not. Therefore the linter result alone does not establish public SELECT exposure. Do not add policies just to silence the advisor.

The advisor reports six anon-executable and seventeen authenticated-executable SECURITY DEFINER functions. Some are application RPCs and some are trigger-oriented functions. Review each function body, grant, and caller intent before modifying privileges. In particular, do not apply a blanket revoke that could break project membership checks, role helpers, reporting RPCs, competitor recomputation, or UI preferences.

Other baseline warnings include two invoker functions with mutable search paths (`site_host(text)` and `alias_match_pattern(text[])`), disabled leaked-password protection, ten unindexed foreign keys, seven RLS init-plan warnings, four multiple-permissive-policy warnings, three tables without primary keys, five unused indexes, and one duplicate index.

No advisor remediation has been applied. These findings are recorded for deliberate security/performance triage and must not be conflated with the replacement branch's own service-role-only candidate staging and promotion controls. The replacement-specific metric-finalization helpers hardened by migration 14 use `search_path=public, pg_temp`.

Reference remediation guidance:
- [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Mutable function search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
- [SECURITY DEFINER executable by anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [SECURITY DEFINER executable by authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)

All checks above were read-only. No Production schema, data, grants, RLS policies, functions, Auth settings, or indexes were changed.


### Backup checklist CLI compatibility note

Use the current Supabase CLI `--remote=<connection-string>` target syntax shown in the [Free-plan backup checklist](./REPLACEMENT_RERUN_FREE_PLAN_BACKUP_CHECKLIST.md). The older `--db-url` flag is deprecated in CLI v3 and removed in CLI v4. The logical dump excludes managed schemas such as `auth` and `storage`; it is not a complete project backup. No export or restore test has yet been performed.
