alter table public.topic_brand_observations
  add column if not exists run_id uuid references public.tracking_runs(id) on delete set null;
alter table public.visibility_daily
  add column if not exists run_id uuid references public.tracking_runs(id) on delete set null;
alter table public.visibility_daily add column if not exists rank_population_count integer;
alter table public.visibility_daily add column if not exists rank_population_status text not null default 'unverified';

alter table public.visibility_daily drop constraint if exists visibility_daily_rank_population_count_check;
alter table public.visibility_daily add constraint visibility_daily_rank_population_count_check
  check (rank_population_count is null or rank_population_count >= 0);
alter table public.visibility_daily drop constraint if exists visibility_daily_rank_population_status_check;
alter table public.visibility_daily add constraint visibility_daily_rank_population_status_check
  check (rank_population_status in ('verified','no_eligible_observations','unverified'));

create index if not exists topic_brand_observations_scope_run_idx
  on public.topic_brand_observations (project_id, topic, metric_date, llm_provider, tracking_location, run_id)
  include (brand_id, response_count, presence_count);
create index if not exists visibility_daily_scope_run_idx
  on public.visibility_daily (project_id, metric_date, topic, llm_provider, tracking_location, run_id);

comment on column public.visibility_daily.rank_population_count is
  'Count of tracked brand plus eligible competitor observations for the exact metric scope. Null means historical scope is unverified.';
comment on column public.visibility_daily.rank_population_status is
  'verified for a complete scoped observation population; no_eligible_observations if none; unverified for legacy metrics.';
comment on column public.visibility_daily.run_id is
  'Tracking run that produced this canonical daily metric row; null for unverifiable legacy lineage.';
comment on column public.topic_brand_observations.run_id is
  'Tracking run that last published this canonical daily brand observation; null for legacy rows.';
