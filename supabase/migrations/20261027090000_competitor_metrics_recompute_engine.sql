-- Recompute competitor visibility statistics from the raw stored responses.
--
-- The engine mirrors the edge function's matching rules (supabase/functions/visibility-tracking):
--   * entity aliases = canonical name + registry aliases + topic aliases + website hosts + first host label
--   * a term matches as a whole token (non-alphanumerics are interchangeable separators), case-insensitive
--   * presence = distinct valid responses with at least one match; mentions = number of matches
--   * average position = mean order of first appearance among all matched entities in a response
-- Raw responses are never modified. Derived rows are rebuilt for the current competitor set.

alter table public.tracking_runs add column if not exists source_run_id uuid references public.tracking_runs(id);
comment on column public.tracking_runs.source_run_id is
  'For a backfilled topic slice of an older all-topic run: the run whose stored responses it republishes. Null for runs that own their responses.';

-- Archives so replacing a competitor set never destroys what was previously configured or derived.
create table if not exists public.topic_brand_assignments_archive (like public.topic_brand_assignments);
alter table public.topic_brand_assignments_archive
  add column if not exists archived_at timestamptz not null default now(),
  add column if not exists archive_reason text;
create table if not exists public.topic_brand_observations_archive (like public.topic_brand_observations);
alter table public.topic_brand_observations_archive
  add column if not exists archived_at timestamptz not null default now(),
  add column if not exists archive_reason text;
alter table public.topic_brand_assignments_archive enable row level security;
alter table public.topic_brand_observations_archive enable row level security;
grant all on public.topic_brand_assignments_archive, public.topic_brand_observations_archive to service_role;

create or replace function public.site_host(v text) returns text
language sql immutable as $$
  select nullif(split_part(split_part(regexp_replace(regexp_replace(
    lower(btrim(coalesce(v, ''))), '^https?://', ''), '^www[.]', ''), '/', 1), ':', 1), '')
$$;

-- Whole-token alternation regex identical in meaning to matcherFor() in the edge function.
create or replace function public.alias_match_pattern(terms text[]) returns text
language sql immutable as $$
  select case when count(*) = 0 then null
    else '(?<![A-Za-z0-9])(?:' || string_agg(p, '|' order by len desc, p) || ')(?![A-Za-z0-9])' end
  from (
    select q.p, length(s.t) as len
    from (select distinct btrim(t) as t from unnest(terms) t where length(btrim(t)) > 1) s
    cross join lateral (
      select nullif(array_to_string(array(
        select tok from regexp_split_to_table(s.t, '[^A-Za-z0-9]+') tok where tok <> ''
      ), '[^A-Za-z0-9]+'), '') as p
    ) q
    where q.p is not null
  ) z
$$;

-- Citation URLs are normalised with the existing public.canonicalize_citation_url(input_url) (Issue 04).

-- Active competitors with the exact alias/website sets the edge function builds.
create or replace function public.competitor_entities(p_project_id uuid)
returns table(topic text, brand_id uuid, canonical_name text, websites text[], aliases text[], pattern text)
language sql stable security definer set search_path = public as $$
  with base as (
    select a.topic, b.id as brand_id, b.canonical_name,
      array(select distinct public.site_host(w) from unnest(
        coalesce(a.websites, '{}') || array[b.primary_website] || coalesce(b.additional_websites, '{}')) w
        where public.site_host(w) is not null) as websites,
      coalesce(b.aliases, '{}') as b_aliases, coalesce(a.aliases, '{}') as a_aliases
    from public.topic_brand_assignments a
    join public.brand_registry b on b.id = a.brand_id and b.is_active
    where a.project_id = p_project_id and a.role = 'competitor' and a.include_in_metrics
  )
  select base.topic, base.brand_id, base.canonical_name, base.websites, q.al, public.alias_match_pattern(q.al)
  from base
  cross join lateral (
    select array(select distinct btrim(v) from unnest(
      array[base.canonical_name] || base.b_aliases || base.a_aliases || base.websites
      || array(select regexp_replace(split_part(w, '.', 1), '[-_]+', ' ', 'g') from unnest(base.websites) w)) v
      where length(btrim(v)) > 1) as al
  ) q;
$$;

-- Tracked-brand and rank helpers now respect the current competitor set and backfilled slices.
create or replace function public.run_tracked_presence(p_run_id uuid, p_topic text)
returns table(presence_count integer, response_count integer)
language sql stable security definer set search_path = public as $$
  with resp as (
    select ar.id
    from public.ai_responses ar
    left join public.prompts pr on pr.id = ar.prompt_id
    where ar.run_id = coalesce((select t.source_run_id from public.tracking_runs t where t.id = p_run_id), p_run_id)
      and ar.response_status = 'completed'
      and (p_topic = 'Overall' or pr.topic = p_topic)
  )
  select
    (select count(distinct e.response_id)::integer
       from public.response_brand_evidence e
       join public.brand_registry b on b.id = e.brand_id and b.is_tracked_brand
       join resp r on r.id = e.response_id
      where e.match_source = 'response_text'),
    (select count(*)::integer from resp);
$$;

create or replace function public.canonical_scoped_rank(
  p_project_id uuid, p_run_id uuid, p_topic text, p_metric_date date,
  p_provider text, p_location text, p_tracked_presence integer, p_tracked_responses integer
) returns table(visibility_rank integer, rank_population_count integer, rank_population_status text)
language sql stable security definer set search_path = public as $$
  with comp as (
    select o.presence_count, o.response_count
    from public.topic_brand_observations o
    where o.project_id = p_project_id and o.run_id = p_run_id and o.topic = p_topic
      and o.metric_date = p_metric_date and o.llm_provider = p_provider
      and o.tracking_location = p_location and o.response_count > 0
      and exists (
        select 1 from public.topic_brand_assignments a
        where a.project_id = p_project_id and a.brand_id = o.brand_id and a.role = 'competitor'
          and a.include_in_metrics and (p_topic = 'Overall' or a.topic = p_topic))
  )
  select
    case when coalesce(p_tracked_responses, 0) = 0 or not exists (select 1 from comp) then null
         else 1 + (select count(*) from comp c
                   where c.presence_count::numeric * p_tracked_responses > p_tracked_presence::numeric * c.response_count)::integer
    end,
    case when coalesce(p_tracked_responses, 0) = 0 or not exists (select 1 from comp) then 0
         else (select count(*) from comp)::integer + 1 end,
    case when coalesce(p_tracked_responses, 0) = 0 or not exists (select 1 from comp)
         then 'no_eligible_observations' else 'verified' end;
$$;

-- Overall pools the latest published topic runs; idempotent (re-running reuses the aggregate run).
create or replace function public.publish_overall_metrics(
  p_project_id uuid, p_metric_date date, p_location text, p_provider text default 'chatgpt'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_topics text[];
  v_members uuid[];
  v_member_topics text[];
  v_agg uuid;
  v_pres integer;
  v_resp integer;
  v_rank record;
  v_citations integer;
  v_sov_tracked numeric;
  v_sov_total numeric;
  v_sov_rank integer;
  v_tracked_pos numeric;
  v_pos_rank integer;
begin
  select array(select t from unnest(p.topics) t where t <> 'Overall') into v_topics
  from public.projects p where p.id = p_project_id;
  if coalesce(cardinality(v_topics), 0) = 0 then return null; end if;

  select array_agg(r.id order by r.topic), array_agg(r.topic order by r.topic)
  into v_members, v_member_topics
  from (
    select distinct on (tr.topic) tr.id, tr.topic
    from public.tracking_runs tr
    where tr.project_id = p_project_id and tr.provider = p_provider and tr.tracking_location = p_location
      and tr.status = 'completed' and tr.published_at is not null and tr.superseded_at is null
      and tr.run_kind = 'topic' and tr.topic = any(v_topics)
      and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
    order by tr.topic, tr.published_at desc, tr.id desc
  ) r;

  if coalesce(cardinality(v_members), 0) <> cardinality(v_topics) then return null; end if;

  select sum(t.presence_count), sum(t.response_count) into v_pres, v_resp
  from unnest(v_members, v_member_topics) m(run_id, topic)
  cross join lateral public.run_tracked_presence(m.run_id, m.topic) t;
  if coalesce(v_resp, 0) = 0 then return null; end if;

  -- Reuse the active aggregate when it already pools exactly these member runs.
  select x.id into v_agg
  from public.tracking_runs x
  where x.project_id = p_project_id and x.provider = p_provider and x.tracking_location = p_location
    and x.run_kind = 'overall_aggregate' and x.published_at is not null and x.superseded_at is null
    and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
    and exists (select 1 from public.visibility_daily v
                where v.run_id = x.id and v.topic = 'Overall' and v.llm_provider = 'Overall'
                  and v.source_run_ids is not distinct from v_members)
  limit 1;

  if v_agg is null then
    update public.tracking_runs set superseded_at = now()
    where project_id = p_project_id and provider = p_provider and tracking_location = p_location
      and run_kind = 'overall_aggregate' and published_at is not null and superseded_at is null
      and (published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date;

    insert into public.tracking_runs (
      project_id, provider, status, total_prompts, completed_prompts, failed_prompts,
      started_at, completed_at, tracking_location, topic, published_at, run_kind, supersedes_run_id
    )
    select p_project_id, p_provider, 'completed', sum(total_prompts), sum(completed_prompts), 0,
      min(started_at), max(completed_at), p_location, null, max(published_at), 'overall_aggregate',
      (select x.id from public.tracking_runs x where x.project_id = p_project_id and x.provider = p_provider
         and x.tracking_location = p_location and x.run_kind = 'overall_aggregate'
         and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
       order by x.superseded_at desc nulls last, x.published_at desc limit 1)
    from public.tracking_runs where id = any(v_members)
    returning id into v_agg;
  end if;

  insert into public.topic_brand_observations (
    project_id, brand_id, topic, metric_date, tracking_location, llm_provider,
    presence_count, response_count, mention_count, citation_count, average_position, run_id
  )
  select p_project_id, o.brand_id, 'Overall', p_metric_date, p_location, p_provider,
    sum(o.presence_count), sum(o.response_count), sum(o.mention_count), sum(o.citation_count),
    case when sum(o.presence_count) filter (where o.average_position is not null) > 0
      then round(sum(o.average_position * o.presence_count) filter (where o.average_position is not null)
                 / sum(o.presence_count) filter (where o.average_position is not null), 2) end,
    v_agg
  from public.topic_brand_observations o
  join unnest(v_members, v_member_topics) m(run_id, topic) on o.run_id = m.run_id and o.topic = m.topic
  join public.topic_brand_assignments a on a.project_id = o.project_id and a.brand_id = o.brand_id
    and a.topic = o.topic and a.role = 'competitor' and a.include_in_metrics
  where o.project_id = p_project_id and o.llm_provider = p_provider and o.tracking_location = p_location
    and o.response_count > 0
  group by o.brand_id
  on conflict (project_id, brand_id, topic, metric_date, tracking_location, llm_provider) do update set
    presence_count = excluded.presence_count, response_count = excluded.response_count,
    mention_count = excluded.mention_count, citation_count = excluded.citation_count,
    average_position = excluded.average_position, run_id = excluded.run_id;

  delete from public.topic_brand_observations
  where project_id = p_project_id and topic = 'Overall' and metric_date = p_metric_date
    and tracking_location = p_location and llm_provider = p_provider and run_id is distinct from v_agg;

  select * into v_rank from public.canonical_scoped_rank(
    p_project_id, v_agg, 'Overall', p_metric_date, p_provider, p_location, v_pres, v_resp);

  select coalesce(sum(v.citation_count), 0) into v_citations
  from public.visibility_daily v
  join unnest(v_members, v_member_topics) m(run_id, topic) on v.run_id = m.run_id and v.topic = m.topic
  where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
    and v.llm_provider = 'Overall';

  select sum(t.total - t.comp), sum(t.total)
  into v_sov_tracked, v_sov_total
  from (
    select (comp.mentions / (1 - v.share_of_voice_score / 100)) as total, comp.mentions as comp
    from public.visibility_daily v
    join unnest(v_members, v_member_topics) m(run_id, topic) on v.run_id = m.run_id and v.topic = m.topic
    cross join lateral (
      select coalesce(sum(o.mention_count), 0)::numeric as mentions from public.topic_brand_observations o
      where o.run_id = m.run_id and o.topic = m.topic and o.llm_provider = p_provider
        and o.tracking_location = p_location and o.metric_date = p_metric_date and o.response_count > 0
        and exists (select 1 from public.topic_brand_assignments a
                    where a.project_id = o.project_id and a.brand_id = o.brand_id and a.topic = o.topic
                      and a.role = 'competitor' and a.include_in_metrics)
    ) comp
    where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
      and v.llm_provider = 'Overall' and v.share_of_voice_score is not null and v.share_of_voice_score < 100
  ) t;

  v_sov_rank := case when v_sov_total > 0
    then 1 + (select count(*) from public.topic_brand_observations o
              where o.run_id = v_agg and o.topic = 'Overall' and o.response_count > 0 and o.mention_count > v_sov_tracked)::integer end;

  select sum(v.average_position * t.presence_count) / nullif(sum(t.presence_count), 0)
  into v_tracked_pos
  from public.visibility_daily v
  join unnest(v_members, v_member_topics) m(run_id, topic) on v.run_id = m.run_id and v.topic = m.topic
  cross join lateral public.run_tracked_presence(m.run_id, m.topic) t
  where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
    and v.llm_provider = 'Overall' and v.average_position is not null;
  v_pos_rank := case when v_tracked_pos is not null and exists (
      select 1 from public.topic_brand_observations o where o.run_id = v_agg and o.topic = 'Overall' and o.average_position is not null)
    then 1 + (select count(*) from public.topic_brand_observations o
              where o.run_id = v_agg and o.topic = 'Overall' and o.average_position is not null
                and o.average_position < v_tracked_pos)::integer end;

  insert into public.visibility_daily (
    project_id, metric_date, tracking_location, topic, llm_provider, run_id,
    visibility_score, visibility_rank, rank_population_count, rank_population_status,
    share_of_voice_score, share_of_voice_rank, average_position, average_position_rank, citation_count,
    presence_count, response_count, source_run_ids, metric_version
  )
  select p_project_id, p_metric_date, p_location, 'Overall', prov, v_agg,
    round(v_pres::numeric / v_resp * 100, 1), v_rank.visibility_rank, v_rank.rank_population_count, v_rank.rank_population_status,
    case when v_sov_total > 0 then round(v_sov_tracked / v_sov_total * 100, 1) end, v_sov_rank,
    case when v_tracked_pos is not null then round(v_tracked_pos, 2) end, v_pos_rank, v_citations,
    v_pres, v_resp, v_members, 'v2'
  from unnest(array['Overall', p_provider]) prov
  on conflict (project_id, metric_date, topic, llm_provider, tracking_location) do update set
    run_id = excluded.run_id, visibility_score = excluded.visibility_score, visibility_rank = excluded.visibility_rank,
    rank_population_count = excluded.rank_population_count, rank_population_status = excluded.rank_population_status,
    share_of_voice_score = excluded.share_of_voice_score, share_of_voice_rank = excluded.share_of_voice_rank,
    average_position = excluded.average_position, average_position_rank = excluded.average_position_rank,
    citation_count = excluded.citation_count, presence_count = excluded.presence_count,
    response_count = excluded.response_count, source_run_ids = excluded.source_run_ids,
    metric_version = excluded.metric_version;

  return v_agg;
end;
$$;
