-- recompute_competitor_metrics(project, [from, to]) rebuilds the competitor side of the metrics from raw responses.
--
-- 1. Older all-topic runs (before topic-scoped runs existed) are republished as per-topic slices
--    (tracking_runs.source_run_id) only when the stored tracked-brand score reproduces from the raw responses.
-- 2. For every published topic run it re-matches the CURRENT competitor set against the stored
--    response text, rebuilding evidence, citation occurrences and competitor observations.
-- 3. Rank and population are stamped by the single canonical rank implementation (finalize_run_metrics).
-- 4. Overall is re-pooled from the topic runs (publish_overall_metrics).
-- Observations of brands that are no longer competitors are archived, never silently lost.

create or replace function public.recompute_competitor_metrics(
  p_project_id uuid, p_date_from date default null, p_date_to date default null
) returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '20min' as $$
declare
  v_project public.projects%rowtype;
  v_topics text[];
  v_tracked_id uuid;
  v_tracked_pattern text;
  c record;
  t text;
  u record;
  v_pres integer;
  v_resp integer;
  v_score numeric;
  v_synth uuid;
  v_slices integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_units integer := 0;
  v_obs integer := 0;
  v_evidence integer := 0;
  v_citations integer := 0;
  v_archived integer := 0;
  v_overall integer := 0;
  v_entities integer := 0;
  v_ok boolean;
begin
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'project % not found', p_project_id; end if;
  v_topics := array(select x from unnest(v_project.topics) x where x <> 'Overall');
  if coalesce(cardinality(v_topics), 0) = 0 then
    return jsonb_build_object('status', 'skipped', 'reason', 'project has no topics');
  end if;

  select b.id,
         public.alias_match_pattern(array_remove(
           array[v_project.brand_name, b.canonical_name, b.primary_website]
           || coalesce(b.aliases, '{}') || coalesce(v_project.brand_terms, '{}')
           || coalesce(v_project.brand_domains, '{}') || coalesce(b.additional_websites, '{}'), null))
  into v_tracked_id, v_tracked_pattern
  from public.brand_registry b
  where b.project_id = p_project_id and b.is_tracked_brand and b.is_active
  limit 1;

  -- 1. Republish verifiable per-topic slices of older all-topic runs.
  for c in
    select distinct on (tr.d, tr.tracking_location, tr.provider) tr.*
    from (
      select r.*, (r.completed_at at time zone 'Asia/Kuala_Lumpur')::date as d
      from public.tracking_runs r
      where r.project_id = p_project_id and r.run_kind = 'full' and r.status = 'completed'
        and r.completed_at is not null and r.provider = 'chatgpt'
    ) tr
    where (p_date_from is null or tr.d >= p_date_from) and (p_date_to is null or tr.d <= p_date_to)
      and not exists (
        select 1 from public.tracking_runs x
        where x.project_id = tr.project_id and x.run_kind = 'topic' and x.source_run_id is null
          and x.status = 'completed' and x.published_at is not null and x.superseded_at is null
          and x.tracking_location = tr.tracking_location and x.provider = tr.provider
          and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = tr.d)
    order by tr.d, tr.tracking_location, tr.provider, tr.completed_at desc
  loop
    foreach t in array v_topics loop
      if exists (select 1 from public.tracking_runs x
                 where x.source_run_id = c.id and x.topic = t and x.published_at is not null and x.superseded_at is null) then
        continue;
      end if;
      select p.presence_count, p.response_count into v_pres, v_resp from public.run_tracked_presence(c.id, t) p;
      select v.visibility_score into v_score from public.visibility_daily v
      where v.project_id = p_project_id and v.metric_date = c.d and v.topic = t
        and v.llm_provider = 'Overall' and v.tracking_location = c.tracking_location;
      if coalesce(v_resp, 0) > 0 and v_score is not null
         and abs(round(v_pres::numeric / v_resp * 100, 1) - v_score) <= 0.05 then
        insert into public.tracking_runs (
          project_id, provider, status, total_prompts, completed_prompts, failed_prompts, started_at, completed_at,
          tracking_location, topic, published_at, run_kind, source_run_id, error_message)
        values (p_project_id, c.provider, 'completed', v_resp, v_resp, 0, c.started_at, c.completed_at,
          c.tracking_location, t, c.completed_at, 'topic', c.id, 'Backfilled topic slice of all-topic run ' || c.id)
        returning id into v_synth;
        update public.visibility_daily set run_id = v_synth
        where project_id = p_project_id and metric_date = c.d and topic = t
          and tracking_location = c.tracking_location and llm_provider in ('Overall', 'chatgpt');
        v_slices := v_slices + 1;
      else
        v_skipped := v_skipped || jsonb_build_object(
          'date', c.d, 'topic', t, 'stored_score', v_score,
          'recomputed', case when coalesce(v_resp, 0) > 0 then round(v_pres::numeric / v_resp * 100, 1) end);
      end if;
    end loop;
  end loop;

  -- 2. Units = published topic runs (real or backfilled slices) in range.
  drop table if exists _cm_units; drop table if exists _cm_resp; drop table if exists _cm_entities;
  drop table if exists _cm_hits; drop table if exists _cm_cit;
  create temp table _cm_units on commit drop as
  select tr.id as unit_run, coalesce(tr.source_run_id, tr.id) as src_run, tr.topic, tr.tracking_location as loc,
         tr.provider, (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date as d
  from public.tracking_runs tr
  where tr.project_id = p_project_id and tr.run_kind = 'topic' and tr.status = 'completed'
    and tr.published_at is not null and tr.superseded_at is null and tr.provider = 'chatgpt'
    and tr.topic = any(v_topics)
    and (p_date_from is null or (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date >= p_date_from)
    and (p_date_to is null or (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date <= p_date_to);

  create temp table _cm_resp on commit drop as
  select distinct on (u.unit_run, ar.prompt_id) u.unit_run, u.src_run, u.topic, u.loc, u.d, u.provider,
         ar.id as response_id, ar.response_text, ar.raw_response
  from _cm_units u
  join public.ai_responses ar on ar.run_id = u.src_run and ar.response_status = 'completed'
    and coalesce(btrim(ar.response_text), '') <> ''
  join public.prompts p on p.id = ar.prompt_id and p.topic = u.topic
  order by u.unit_run, ar.prompt_id, ar.captured_at desc, ar.id desc;
  create index on _cm_resp (unit_run);

  create temp table _cm_entities on commit drop as
  select * from public.competitor_entities(p_project_id) e where e.pattern is not null and e.topic = any(v_topics);
  select count(distinct brand_id) into v_entities from _cm_entities;

  -- 3a. Text matches (competitors) plus the tracked brand for position ordering.
  create temp table _cm_hits on commit drop as
  select r.unit_run, r.response_id, e.brand_id, false as is_tracked,
         regexp_count(r.response_text, e.pattern, 1, 'i') as n,
         regexp_instr(r.response_text, e.pattern, 1, 1, 0, 'i') as pos
  from _cm_resp r
  join _cm_entities e on e.topic = r.topic and r.response_text ~* e.pattern;
  if v_tracked_pattern is not null then
    insert into _cm_hits
    select r.unit_run, r.response_id, v_tracked_id, true,
           regexp_count(r.response_text, v_tracked_pattern, 1, 'i'),
           regexp_instr(r.response_text, v_tracked_pattern, 1, 1, 0, 'i')
    from _cm_resp r where r.response_text ~* v_tracked_pattern;
  end if;

  -- 3b. Evidence for the current competitor set (response-text matches).
  insert into public.response_brand_evidence (
    project_id, response_id, brand_id, topic, match_source, matched_value, evidence_text,
    first_position, occurrence_count, confidence)
  select p_project_id, h.response_id, h.brand_id, e.topic, 'response_text', e.canonical_name,
         substr(r.response_text, greatest(1, h.pos - 80), 260), h.pos - 1, h.n, 'deterministic'
  from _cm_hits h
  join _cm_resp r on r.response_id = h.response_id and r.unit_run = h.unit_run
  join _cm_entities e on e.brand_id = h.brand_id and e.topic = r.topic
  where not h.is_tracked
  on conflict (response_id, brand_id, topic, match_source, matched_value) do update set
    evidence_text = excluded.evidence_text, first_position = excluded.first_position,
    occurrence_count = excluded.occurrence_count;
  get diagnostics v_evidence = row_count;

  -- 3c. Citation occurrences: cited URLs (url_citation annotations) attributed by domain to each competitor.
  create temp table _cm_cit on commit drop as
  select distinct r.unit_run, r.src_run, r.response_id, r.topic, r.loc, r.d, r.provider, e.brand_id,
         cu.url as citation_url, public.canonicalize_citation_url(cu.url) as canonical_url,
         lower(split_part(split_part(regexp_replace(public.canonicalize_citation_url(cu.url), '^https?://', '', 'i'), '/', 1), ':', 1)) as host
  from _cm_resp r
  cross join lateral (
    select a ->> 'url' as url
    from jsonb_path_query(r.raw_response, '$.output[*].content[*].annotations[*] ? (@.type == "url_citation")') a
  ) cu
  join _cm_entities e on e.topic = r.topic
  where cu.url ~* '^https?://'
    and exists (select 1 from unnest(e.websites) w
                where lower(split_part(split_part(regexp_replace(public.canonicalize_citation_url(cu.url), '^https?://', '', 'i'), '/', 1), ':', 1)) = w
                   or lower(split_part(split_part(regexp_replace(public.canonicalize_citation_url(cu.url), '^https?://', '', 'i'), '/', 1), ':', 1)) like '%.' || w);

  delete from public.citation_occurrences co
  using _cm_resp r, _cm_entities e
  where co.response_id = r.response_id and co.entity_id = e.brand_id and e.topic = r.topic;
  insert into public.citation_occurrences (
    project_id, response_id, entity_id, topic, metric_date, provider, tracking_location, run_id,
    citation_url, canonical_url, canonical_domain, citation_index)
  select distinct on (response_id, brand_id, canonical_url)
         p_project_id, response_id, brand_id, topic, d, provider, loc, src_run, citation_url, canonical_url, host, 1
  from _cm_cit
  order by response_id, brand_id, canonical_url, citation_url
  on conflict (response_id, entity_id, canonical_url) do nothing;
  get diagnostics v_citations = row_count;

  -- 3d. Competitor observations for every unit (zero-presence competitors included).
  insert into public.topic_brand_observations (
    project_id, brand_id, topic, metric_date, tracking_location, llm_provider,
    presence_count, response_count, mention_count, citation_count, average_position, run_id)
  select p_project_id, e.brand_id, u.topic, u.d, u.loc, u.provider,
         coalesce(h.presence, 0), rc.n, coalesce(h.mentions, 0), coalesce(cc.n, 0), ap.avg_pos, u.unit_run
  from _cm_units u
  join (select unit_run, count(*)::integer as n from _cm_resp group by unit_run) rc on rc.unit_run = u.unit_run
  join _cm_entities e on e.topic = u.topic
  left join (select unit_run, brand_id, count(*)::integer as presence, sum(n)::integer as mentions
             from _cm_hits where not is_tracked group by unit_run, brand_id) h
         on h.unit_run = u.unit_run and h.brand_id = e.brand_id
  left join (select unit_run, brand_id, count(distinct (response_id, canonical_url))::integer as n
             from _cm_cit group by unit_run, brand_id) cc
         on cc.unit_run = u.unit_run and cc.brand_id = e.brand_id
  left join (select unit_run, brand_id, round(avg(rk)::numeric, 2) as avg_pos
             from (select unit_run, brand_id,
                          row_number() over (partition by response_id order by pos, is_tracked desc, brand_id) as rk
                   from _cm_hits) z group by unit_run, brand_id) ap
         on ap.unit_run = u.unit_run and ap.brand_id = e.brand_id
  on conflict (project_id, brand_id, topic, metric_date, tracking_location, llm_provider) do update set
    presence_count = excluded.presence_count, response_count = excluded.response_count,
    mention_count = excluded.mention_count, citation_count = excluded.citation_count,
    average_position = excluded.average_position, run_id = excluded.run_id;
  get diagnostics v_obs = row_count;

  -- 3e. Archive then remove derived observations of brands that are no longer competitors in these scopes.
  insert into public.topic_brand_observations_archive
  select o.*, now(), 'competitor set replaced'
  from public.topic_brand_observations o
  join _cm_units u on u.topic = o.topic and u.d = o.metric_date and u.loc = o.tracking_location and u.provider = o.llm_provider
  where o.project_id = p_project_id
    and not exists (select 1 from _cm_entities e where e.topic = o.topic and e.brand_id = o.brand_id);
  get diagnostics v_archived = row_count;
  delete from public.topic_brand_observations o
  using _cm_units u
  where o.project_id = p_project_id and u.topic = o.topic and u.d = o.metric_date
    and u.loc = o.tracking_location and u.provider = o.llm_provider
    and not exists (select 1 from _cm_entities e where e.topic = o.topic and e.brand_id = o.brand_id);

  -- 4. Rank + population via the canonical implementation; a unit whose tracked score no longer reproduces is reported.
  for u in select * from _cm_units order by d, topic loop
    begin
      perform public.finalize_run_metrics(u.unit_run);
      v_units := v_units + 1;
    exception when others then
      v_blocked := v_blocked || jsonb_build_object('date', u.d, 'topic', u.topic, 'reason', sqlerrm);
    end;
  end loop;

  -- 5. Overall pools the topic runs of each day.
  for u in select distinct d, loc, provider from _cm_units order by d loop
    if public.publish_overall_metrics(p_project_id, u.d, u.loc, u.provider) is not null then
      v_overall := v_overall + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'completed', 'competitors', v_entities, 'slices_backfilled', v_slices,
    'units_finalized', v_units, 'overall_days', v_overall,
    'observations_written', v_obs, 'evidence_rows', v_evidence, 'citation_occurrences_added', v_citations,
    'observations_archived', v_archived, 'slices_unverified', v_skipped, 'units_blocked', v_blocked);
end;
$$;

revoke all on function public.recompute_competitor_metrics(uuid, date, date) from public, anon, authenticated;
grant execute on function public.recompute_competitor_metrics(uuid, date, date) to service_role;
