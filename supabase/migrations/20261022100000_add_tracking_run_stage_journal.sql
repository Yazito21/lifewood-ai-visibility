create table if not exists public.tracking_run_stages (
  run_id uuid not null references public.tracking_runs(id) on delete cascade,
  stage_key text not null,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (run_id, stage_key)
);
create index if not exists tracking_run_stages_status_updated_idx on public.tracking_run_stages (status, updated_at desc);
alter table public.tracking_run_stages enable row level security;
revoke all on public.tracking_run_stages from anon, authenticated;
grant all on public.tracking_run_stages to service_role;
