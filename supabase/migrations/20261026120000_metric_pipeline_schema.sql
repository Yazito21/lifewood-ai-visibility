-- Issues 02/03/06/08/09/10/11: schema support for one canonical metric pipeline.
--
-- visibility_daily keeps the exact tracked-brand numerator and denominator so a
-- rank can always be recomputed from unrounded values, and records which runs
-- produced the row. tracking_runs gains an explicit run kind and a superseded
-- marker so exactly one run per scope/day is the published run.

alter table public.visibility_daily
  add column if not exists presence_count integer,
  add column if not exists response_count integer,
  add column if not exists source_run_ids uuid[],
  add column if not exists metric_version text;

alter table public.visibility_daily drop constraint if exists visibility_daily_counts_check;
alter table public.visibility_daily add constraint visibility_daily_counts_check
  check (
    (presence_count is null and response_count is null)
    or (presence_count >= 0 and response_count >= 0 and presence_count <= response_count)
  );

comment on column public.visibility_daily.presence_count is
  'Distinct valid responses in this exact scope that mention the tracked brand (visibility numerator).';
comment on column public.visibility_daily.response_count is
  'Distinct valid completed responses in this exact scope (visibility denominator).';
comment on column public.visibility_daily.source_run_ids is
  'Published runs that produced this row. One run for topic rows; the member topic runs for pooled Overall rows.';
comment on column public.visibility_daily.metric_version is
  'Calculation version from public.metric_definitions used to produce this row; null for unversioned legacy rows.';

alter table public.tracking_runs
  add column if not exists run_kind text,
  add column if not exists superseded_at timestamptz;

alter table public.tracking_runs drop constraint if exists tracking_runs_run_kind_check;
alter table public.tracking_runs add constraint tracking_runs_run_kind_check
  check (run_kind is null or run_kind in ('topic', 'full', 'overall_aggregate'));

comment on column public.tracking_runs.run_kind is
  'topic: single-topic run; full: legacy all-topic run; overall_aggregate: publication record that pools the latest published topic runs of one day.';
comment on column public.tracking_runs.superseded_at is
  'Set when a later published run replaced this run for the same project/topic/provider/location/day. Superseded runs are retained for audit.';

-- Existing run rows keep their meaning: topic runs already carry topic, legacy
-- all-topic runs carry none.
update public.tracking_runs set run_kind = case when topic is null then 'full' else 'topic' end
where run_kind is null;

-- Metric definitions and calculation versions (Issue 11).
create table if not exists public.metric_definitions (
  metric_key text not null,
  version text not null,
  label text not null,
  unit text not null,
  definition text not null,
  numerator text,
  denominator text,
  scope text not null,
  tie_policy text,
  missing_data_policy text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (metric_key, version)
);
alter table public.metric_definitions enable row level security;
drop policy if exists "metric_definitions readable by authenticated" on public.metric_definitions;
create policy "metric_definitions readable by authenticated" on public.metric_definitions
  for select to authenticated using (true);
grant select on public.metric_definitions to authenticated;
grant all on public.metric_definitions to service_role;

insert into public.metric_definitions
  (metric_key, version, label, unit, definition, numerator, denominator, scope, tie_policy, missing_data_policy)
values
  ('visibility_score', 'v2', 'Visibility Score', 'percent of responses',
   'Share of valid AI responses that mention the entity at least once. The same calculation is used for the tracked brand and every competitor.',
   'Distinct valid responses mentioning the entity (aliases/domains normalised, repeats in one response count once).',
   'Distinct valid completed responses in the same project, date, topic, engine and location.',
   'project + metric_date + topic + engine + tracking_location. Overall pools the responses of all topics published that day (it is not an average of topic scores).',
   null,
   'Responses that failed or were not analysed are excluded from both numerator and denominator.'),
  ('visibility_rank', 'v2', 'Visibility Rank', 'position',
   'Position of the tracked brand among the tracked brand plus competitors that have valid observations in the same scope. Rank 1 is best.',
   null, null,
   'Same scope as the visibility score. The population (the "/N") is the tracked brand plus competitors with at least one valid response in that scope.',
   'Competition ranking from unrounded scores: entities with an equal score share a rank (1, 1, 3). Leaderboards order ties by citation occurrences, then name.',
   'Competitors without a valid observation for the scope are excluded and reported as missing coverage; they are never counted as zero. Rows whose population cannot be verified are labelled unverified.'),
  ('share_of_voice', 'v2', 'Share of Voice', 'percent of mentions',
   'The tracked brand''s share of all entity mentions in the scope.',
   'Mentions of the tracked brand.', 'Mentions of the tracked brand plus eligible competitors.',
   'Same scope as the visibility score.', 'Competition ranking, rank 1 is most mentions.',
   'Competitors without a valid observation are excluded.'),
  ('citation_occurrences', 'v2', 'Citation Occurrences', 'citations',
   'Number of cited URLs attributed to the entity. One canonical URL counts once per response; the same URL in separate responses counts once per response.',
   'Distinct (response, entity, canonical URL).', null,
   'Same scope as the visibility score. Tracked brand and competitors use the identical attribution rule.',
   'Leaderboard ties are ordered by visibility score, then name.', 'Responses without citations contribute zero.'),
  ('unique_cited_pages', 'v2', 'Unique Cited Pages', 'pages',
   'Distinct canonical URLs cited for the entity in the scope.', null, null,
   'Same scope as citation occurrences.', null, null),
  ('unique_cited_domains', 'v2', 'Unique Cited Domains', 'domains',
   'Distinct canonical domains cited for the entity in the scope.', null, null,
   'Same scope as citation occurrences.', null, null)
on conflict (metric_key, version) do nothing;

-- Indexes supporting scoped, published selection (Issues 05/06/10).
create index if not exists tracking_runs_published_day_idx
  on public.tracking_runs (project_id, tracking_location, provider, ((published_at at time zone 'Asia/Kuala_Lumpur')::date), topic)
  where status = 'completed' and published_at is not null;
create index if not exists visibility_daily_run_idx
  on public.visibility_daily (run_id) where run_id is not null;
