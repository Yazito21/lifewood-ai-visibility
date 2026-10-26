-- Issues 05/07/09/10/12: published-run selection, uniqueness/rank constraints, integrity checks.

-- Topic scopes only ever read topic runs; Overall only reads Overall publications
-- (pooled aggregate, or a legacy full run). Runs superseded by a later publication are ignored.
create or replace function public.get_published_run_ids_for_leaderboard(
  p_project_id uuid, p_start_date date, p_end_date date, p_topic text, p_provider text, p_tracking_location text
) returns table(metric_date date, run_id uuid)
language sql stable security definer set search_path = public as $$
  with scoped_runs as (
    select (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date as metric_date,
      tr.id as run_id,
      row_number() over (partition by (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date
                         order by tr.published_at desc, tr.id desc) as rn
    from public.tracking_runs tr
    where tr.project_id = p_project_id and public.is_project_member(p_project_id)
      and tr.provider = p_provider and tr.tracking_location = p_tracking_location
      and tr.status = 'completed' and tr.published_at is not null and tr.superseded_at is null
      and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date between p_start_date and p_end_date
      and ((p_topic = 'Overall' and tr.run_kind in ('overall_aggregate', 'full'))
        or (p_topic <> 'Overall' and tr.run_kind = 'topic' and tr.topic = p_topic))
  ) select sr.metric_date, sr.run_id from scoped_runs sr where sr.rn = 1;
$$;

create or replace function public.get_published_competitor_observations(
  p_project_id uuid, p_metric_date date, p_topic text, p_provider text, p_tracking_location text
) returns table(
  published_run_id uuid, published_at timestamptz, run_status text,
  expected_competitor_count integer, observed_competitor_count integer, coverage_status text,
  brand_id uuid, presence_count integer, response_count integer, mention_count integer,
  citation_count integer, average_position numeric
) language sql stable security definer set search_path = public as $$
  with canonical_run as (
    select tr.id, tr.published_at, tr.status from public.tracking_runs tr
    where tr.project_id = p_project_id and tr.provider = p_provider
      and tr.tracking_location = p_tracking_location and tr.status = 'completed'
      and tr.published_at is not null and tr.superseded_at is null
      and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
      and ((p_topic = 'Overall' and tr.run_kind in ('overall_aggregate', 'full'))
        or (p_topic <> 'Overall' and tr.run_kind = 'topic' and tr.topic = p_topic))
    order by tr.published_at desc, tr.id desc limit 1
  ), eligible as (
    select distinct tba.brand_id as id from public.topic_brand_assignments tba
    where tba.project_id = p_project_id and tba.role = 'competitor' and tba.include_in_metrics = true
      and (p_topic = 'Overall' or tba.topic = p_topic)
  ), scoped as (
    select o.* from public.topic_brand_observations o
    join canonical_run cr on cr.id = o.run_id
    join eligible e on e.id = o.brand_id
    where o.project_id = p_project_id and o.metric_date = p_metric_date and o.topic = p_topic
      and o.llm_provider = p_provider and o.tracking_location = p_tracking_location and o.response_count > 0
  ), counts as (
    select (select count(*)::integer from eligible) expected,
           (select count(distinct brand_id)::integer from scoped) observed
  )
  select cr.id, cr.published_at, cr.status, counts.expected, counts.observed,
    case when counts.observed = 0 then 'missing_observations'
         when counts.observed < counts.expected then 'partial_coverage' else 'complete' end,
    s.brand_id, s.presence_count, s.response_count, s.mention_count, s.citation_count, s.average_position
  from canonical_run cr cross join counts left join scoped s on true
  union all
  select null::uuid, null::timestamptz, null::text, (select count(*)::integer from eligible), 0,
    'missing_published_run', null::uuid, null::integer, null::integer, null::integer, null::integer, null::numeric
  where not exists (select 1 from canonical_run);
$$;

-- Exactly one active published run per project/topic/kind/engine/location/day.
create unique index if not exists tracking_runs_one_active_published_per_scope_day
  on public.tracking_runs (
    project_id, provider, tracking_location, coalesce(topic, ''), coalesce(run_kind, ''),
    ((published_at at time zone 'Asia/Kuala_Lumpur')::date))
  where status = 'completed' and published_at is not null and superseded_at is null;

-- Rank sanity (Issue 09): integer rank >= 1, never worse than the population when both are known.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'visibility_daily_rank_valid_check') then
    alter table public.visibility_daily add constraint visibility_daily_rank_valid_check
      check (
        (visibility_rank is null or visibility_rank >= 1)
        and (rank_population_status <> 'verified'
             or (visibility_rank is not null and rank_population_count >= visibility_rank))
        and (rank_population_status <> 'no_eligible_observations' or visibility_rank is null)
      ) not valid;
  end if;
end $$;
alter table public.visibility_daily validate constraint visibility_daily_rank_valid_check;

create index if not exists topic_brand_observations_run_topic_idx
  on public.topic_brand_observations (run_id, topic) where run_id is not null;

-- Integrity report (Issues 05/07/12). One row per violated check; severity 'error' means a metric must not be trusted.
create or replace function public.check_metric_integrity(
  p_project_id uuid default null, p_start_date date default null, p_end_date date default null
) returns table(check_name text, severity text, project_id uuid, metric_date date, topic text, detail text)
language sql stable security definer set search_path = public as $$
  with vd as (
    select v.*, tr.provider as run_provider, tr.status as run_status, tr.published_at as run_published_at, tr.run_kind
    from public.visibility_daily v
    left join public.tracking_runs tr on tr.id = v.run_id
    where v.llm_provider = 'Overall'
      and (p_project_id is null or v.project_id = p_project_id)
      and (p_start_date is null or v.metric_date >= p_start_date)
      and (p_end_date is null or v.metric_date <= p_end_date)
  )
  select 'tracked_score_matches_evidence'::text, 'error'::text, v.project_id, v.metric_date, v.topic,
    format('stored %s vs %s/%s = %s', v.visibility_score, t.presence_count, t.response_count,
           round(t.presence_count::numeric / nullif(t.response_count, 0) * 100, 1))
  from vd v cross join lateral public.run_tracked_presence(v.run_id, v.topic) t
  where v.run_id is not null and v.run_kind in ('topic', 'full') and t.response_count > 0
    and abs(round(t.presence_count::numeric / t.response_count * 100, 1) - v.visibility_score) > 0.05
  union all
  select 'rank_matches_canonical', 'error', v.project_id, v.metric_date, v.topic,
    format('stored %s/%s vs canonical %s/%s', v.visibility_rank, v.rank_population_count, k.visibility_rank, k.rank_population_count)
  from vd v
  cross join lateral public.canonical_scoped_rank(v.project_id, v.run_id, v.topic, v.metric_date,
       coalesce(v.run_provider, 'chatgpt'), v.tracking_location, v.presence_count, v.response_count) k
  where v.run_id is not null and v.presence_count is not null
    and (v.visibility_rank is distinct from k.visibility_rank or v.rank_population_count is distinct from k.rank_population_count)
  union all
  select 'rank_population_unverified', 'warning', v.project_id, v.metric_date, v.topic,
    'rank population is unverified (legacy lineage); excluded from verified comparisons'
  from vd v where v.rank_population_status = 'unverified' and v.visibility_rank is not null
  union all
  select 'competitor_coverage_incomplete', 'warning', v.project_id, v.metric_date, v.topic,
    format('%s of %s registered competitors have valid observations', c.observed, c.expected)
  from vd v
  cross join lateral (
    select max(o.expected_competitor_count) expected, max(o.observed_competitor_count) observed
    from public.get_published_competitor_observations(v.project_id, v.metric_date, v.topic,
         coalesce(v.run_provider, 'chatgpt'), v.tracking_location) o
  ) c
  where v.run_id is not null and v.run_published_at is not null and c.observed < c.expected
  union all
  select 'citation_count_matches_occurrences', 'error', v.project_id, v.metric_date, v.topic,
    format('daily %s vs published-run occurrences %s', v.citation_count, occ.n)
  from vd v
  cross join lateral (
    select count(*)::integer n from public.citation_occurrences co
    join public.brand_registry b on b.id = co.entity_id and b.is_tracked_brand
    where co.project_id = v.project_id and co.metric_date = v.metric_date
      and co.tracking_location = v.tracking_location and (v.topic = 'Overall' or co.topic = v.topic)
      and co.run_id = any(coalesce(v.source_run_ids, array[v.run_id]))
  ) occ
  where v.run_id is not null and v.metric_version is not null and v.run_kind in ('topic', 'overall_aggregate')
    and v.citation_count <> occ.n
  union all
  select 'citation_occurrences_from_unpublished_runs', 'warning', co.project_id, co.metric_date, co.topic,
    format('%s occurrence rows belong to runs that are not the published run (retained for audit, excluded by latest-response selection)', count(*))
  from public.citation_occurrences co
  join public.tracking_runs tr on tr.id = co.run_id
  where (tr.published_at is null or tr.superseded_at is not null)
    and (p_project_id is null or co.project_id = p_project_id)
    and (p_start_date is null or co.metric_date >= p_start_date) and (p_end_date is null or co.metric_date <= p_end_date)
  group by co.project_id, co.metric_date, co.topic
  union all
  select 'daily_metric_without_published_run', 'error', v.project_id, v.metric_date, v.topic,
    'visibility_daily row references a run that is not published'
  from vd v where v.run_id is not null and (v.run_published_at is null or v.run_status <> 'completed')
  union all
  select 'competitor_observations_without_run', 'warning', o.project_id, o.metric_date, o.topic,
    format('%s observation rows have no run lineage', count(*))
  from public.topic_brand_observations o
  where o.run_id is null and (p_project_id is null or o.project_id = p_project_id)
    and (p_start_date is null or o.metric_date >= p_start_date) and (p_end_date is null or o.metric_date <= p_end_date)
  group by o.project_id, o.metric_date, o.topic
  union all
  select 'duplicate_evidence', 'error', d.project_id, null::date, d.topic, format('%s duplicated evidence keys', count(*))
  from (select e.project_id, e.topic, e.response_id, e.brand_id, e.match_source, e.matched_value
        from public.response_brand_evidence e group by 1,2,3,4,5,6 having count(*) > 1) d
  group by d.project_id, d.topic;
$$;

revoke all on function public.check_metric_integrity(uuid, date, date) from public, anon, authenticated;
grant execute on function public.check_metric_integrity(uuid, date, date) to service_role;

comment on function public.check_metric_integrity(uuid, date, date) is
  'Scoped reconciliation of raw responses, evidence, citations, daily metrics and competitor observations. Rows with severity=error indicate a metric that must not be trusted.';
