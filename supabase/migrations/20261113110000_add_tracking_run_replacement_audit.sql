-- Durable audit trail for successful run replacements.
-- Run identifiers are stored as values, deliberately without FKs to tracking_runs:
-- predecessor run rows may be physically deleted after a successful replacement,
-- but the replacement history must remain queryable.

create table if not exists public.tracking_run_replacements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  metric_date date not null,
  category text not null,
  provider text not null,
  tracking_location text not null,
  replacement_run_id uuid not null,
  replaced_run_id uuid not null,
  replaced_run_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(replaced_run_snapshot) = 'object'),
  replacement_run_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(replacement_run_snapshot) = 'object'),
  deleted_row_counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(deleted_row_counts) = 'object'),
  replaced_at timestamptz not null default now(),
  replaced_by uuid references auth.users(id) on delete set null,
  constraint tracking_run_replacements_distinct_runs
    check (replacement_run_id <> replaced_run_id),
  constraint tracking_run_replacements_unique_scope
    unique (project_id, metric_date, category, provider, tracking_location, replaced_run_id)
);

create index if not exists tracking_run_replacements_replacement_run_idx
  on public.tracking_run_replacements (replacement_run_id);

create index if not exists tracking_run_replacements_scope_date_idx
  on public.tracking_run_replacements (project_id, metric_date desc, category, provider, tracking_location);

alter table public.tracking_run_replacements enable row level security;
revoke all on public.tracking_run_replacements from public, anon, authenticated;
grant all on public.tracking_run_replacements to service_role;

comment on table public.tracking_run_replacements is
  'Durable audit of successful run replacements. Run IDs are intentionally not foreign-keyed so predecessor history survives physical run deletion.';
