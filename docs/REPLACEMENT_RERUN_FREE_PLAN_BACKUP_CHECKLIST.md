# Free-Plan Backup Checkpoint for Replacement Reruns

**Status: Procedure prepared; no backup has been exported or restore-tested.**  
**Target project:** `jhauufmrxpsbfrahgclv` (`lifewood-ai-visibility`)  
**Repository:** `Yazito21/lifewood-ai-visibility`

This checklist addresses the backup gate in [the replacement-rerun deployment runbook](./REPLACEMENT_RERUN_DEPLOYMENT_RUNBOOK.md). It is designed to avoid any Supabase plan upgrade, paid branch, or additional hosted project.

## 1. Confirmed plan and backup position

The connected Supabase organization currently reports the **Free** plan. Supabase's current documentation states that Free projects do **not** receive automatic daily database backups. Daily backups are included on Pro, Team, and Enterprise plans. Supabase recommends that Free-plan projects create regular logical exports with the Supabase CLI `db dump` command and keep off-site copies.

Sources:
- [Supabase: Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase: Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase CLI: db dump](https://supabase.com/docs/reference/cli/supabase-db-dump)

No automatic backup or PITR recovery point has been verified for this project. Do not assume one exists. Enabling PITR or upgrading the plan is not part of this procedure and is not authorised.

## 2. Export a logical backup locally

Run this on a trusted workstation before the first Production replacement. Do not paste the database password or connection string into ChatGPT, GitHub, source files, or this repository.

Prerequisites:
- Supabase CLI installed.
- Docker Desktop running (the CLI uses a container for `pg_dump`).
- The Production database connection string copied from the Supabase Dashboard's **Connect** panel. Prefer the Session pooler connection string unless your network supports the direct connection.
- A secure local destination with enough free disk space.

In PowerShell, enter the connection string through a secure prompt. It is converted to a process environment variable only in memory for the duration of the export:

```powershell
$secure = Read-Host "Enter the database connection string" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:SUPABASE_DB_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) { throw "SUPABASE_DB_URL is required." }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $env:USERPROFILE "lifewood-ai-visibility-backups\$timestamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

supabase --version
docker info | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker is not available. Start Docker Desktop and retry." }

supabase db dump --db-url "$env:SUPABASE_DB_URL" -f "$backupDir\roles.sql" --role-only
if ($LASTEXITCODE -ne 0) { throw "Role export failed. Do not proceed." }

supabase db dump --db-url "$env:SUPABASE_DB_URL" -f "$backupDir\schema.sql"
if ($LASTEXITCODE -ne 0) { throw "Schema export failed. Do not proceed." }

supabase db dump --db-url "$env:SUPABASE_DB_URL" -f "$backupDir\data.sql" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
if ($LASTEXITCODE -ne 0) { throw "Data export failed. Do not proceed." }

$manifest = @(
  Get-Item "$backupDir\roles.sql"
  Get-Item "$backupDir\schema.sql"
  Get-Item "$backupDir\data.sql"
) | ForEach-Object {
  $hash = Get-FileHash $_.FullName -Algorithm SHA256
  [pscustomobject]@{
    file = $_.Name
    bytes = $_.Length
    sha256 = $hash.Hash
  }
}

$manifest | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 "$backupDir\manifest.json"
Get-ChildItem $backupDir | Select-Object Name, Length
Remove-Item Env:\SUPABASE_DB_URL
Write-Host "Backup export completed: $backupDir"
```

The commands export roles, schema, and data separately, following Supabase's documented CLI procedure. Keep the generated SQL and manifest outside the repository. Store a second encrypted copy in an approved off-site location. Never upload raw database dumps to a public repository or an unapproved cloud folder.

## 3. Understand what this export does and does not contain

- The CLI applies Supabase-specific filtering and excludes Supabase-managed schemas such as `auth`, `storage`, and extension-owned schemas. It is not a complete image of every managed Supabase service.
- The database export covers the application database schemas included by the CLI, including the public tables used by replacement promotion. Confirm the required tables and their data are present in the dump before accepting it.
- Storage API file objects are not included in a database dump. If any data needed for the wider platform recovery is stored as Storage objects, export those objects separately and record that separate checkpoint.
- Custom role passwords are not included in the export and may need to be reset during a restore.
- This is a logical export at the time the dump runs, not PITR and not an automatically maintained backup.

For the replacement workflow, the critical predecessor payloads are stored in database tables such as `ai_responses` and their associated evidence, citation, mention, observation, and metric tables. Verify that these public-schema tables and their rows are included in the export. Do not treat the replacement audit table as a substitute.

## 4. Verify the export before release

The export is **not** a completed recovery checkpoint merely because the three commands returned successfully.

Before approving the first Production replacement:

1. Confirm all three SQL files are non-empty and the SHA-256 manifest exists.
2. Keep the export and manifest in a separate encrypted/off-site location.
3. Restore the files into an isolated local PostgreSQL/Supabase test environment, never into Production. Follow Supabase's documented CLI restore procedure and use a compatible PostgreSQL version/extensions.
4. Verify the restore completed without SQL errors.
5. Compare row counts for the replacement-critical tables, including `tracking_runs`, `ai_responses`, `response_brand_evidence`, `citation_occurrences`, `third_party_mentions`, `category_brand_observations`, and `visibility_daily`.
6. Confirm the restored rows for the intended project/date/category/provider/location are present and queryable.
7. Record the export timestamp, project ref, file sizes, checksums, restore-test result, and off-site storage location in the release record. Do not record credentials or secret connection strings.

If any step fails, the backup gate remains **blocked**. Do not run a Production replacement.

## 5. Current release decision

As of the latest read-only checks:

- Supabase organization plan: **Free**.
- Supabase project status: **ACTIVE_HEALTHY**.
- No automatic daily backup/PITR recovery point has been confirmed.
- No logical export has been created by this workflow.
- No restore test has been performed.
- No paid Supabase plan, PITR add-on, branch, or additional project is authorised.
- Production migration history still ends at `20261112032011`; none of the fourteen replacement-rerun migrations has been applied.
- The replacement feature remains unapproved for Production use until the manual export and restore-verification gate above is completed, or the user separately gives explicit acceptance of the irreversible predecessor-payload retention behaviour described in the main runbook.

**Safety:** This document is a procedure only. It does not authorise Production migrations, Edge Function deployment, Vercel Production deployment, tracking activation, historical deletion, or a live replacement run.
