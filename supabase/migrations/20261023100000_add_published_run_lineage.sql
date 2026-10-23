-- DATA-02/04: persist run grain and explicit publication/supersession lineage.
-- Existing run rows remain auditable; aggregate rows represent the published run
-- for their project/date/topic/provider/location grain.
alter table public.tracking_runs
  add column if not exists topic text,
  add column if not exists published_at timestamptz,
  add column if not exists supersedes_run_id uuid references public.tracking_runs(id) on delete set null;

create index if not exists tracking_runs_published_grain_idx
  on public.tracking_runs (project_id, topic, provider, tracking_location, completed_at desc)
  where published_at is not null and status = 'completed';

create index if not exists tracking_runs_supersedes_idx
  on public.tracking_runs (supersedes_run_id)
  where supersedes_run_id is not null;

comment on column public.tracking_runs.topic is
  'Topic grain for topic-scoped runs. NULL means legacy/full-project run.';
comment on column public.tracking_runs.published_at is
  'Set only when the completed run successfully wrote its derived aggregates.';
comment on column public.tracking_runs.supersedes_run_id is
  'Previous published run for the same project/topic/provider/location grain; retained for audit.';
