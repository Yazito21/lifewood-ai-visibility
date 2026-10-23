-- TRK-08: persist logical run intent and enforce one row per idempotency key.
-- Deliberate reruns use a new generation_key; retries reuse the same key.
alter table public.tracking_runs
  add column if not exists idempotency_key text,
  add column if not exists generation_key text,
  add column if not exists request_fingerprint text;

create unique index if not exists tracking_runs_idempotency_key_uidx
  on public.tracking_runs (idempotency_key)
  where idempotency_key is not null;

comment on column public.tracking_runs.idempotency_key is
  'Stable key for one logical request; retries reuse it, deliberate reruns create a new generation key.';
comment on column public.tracking_runs.generation_key is
  'Explicit execution generation distinguishing deliberate reruns from retries.';
comment on column public.tracking_runs.request_fingerprint is
  'Canonical fingerprint of project/date/location/topic/provider/batch intent, excluding secrets.';

create table if not exists public.tracking_run_idempotency (
  idempotency_key text primary key,
  request_fingerprint text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid not null references public.tracking_runs(id) on delete cascade,
  generation_key text not null,
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  unique (run_id)
);

alter table public.tracking_run_idempotency enable row level security;
revoke all on public.tracking_run_idempotency from anon, authenticated;
grant select, insert, update, delete on public.tracking_run_idempotency to service_role;
