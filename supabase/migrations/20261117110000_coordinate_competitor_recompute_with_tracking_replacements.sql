-- Coordinate tracking replacement promotions with the live competitor recompute worker.
-- The worker rebuilds response evidence, citation occurrences, category observations,
-- and Overall metrics across a project. A project-scoped transaction lock prevents it
-- from racing a replacement transaction or publishing an Overall snapshot from stale runs.

CREATE OR REPLACE FUNCTION public.publish_engine_overall_metrics(p_project_id uuid, p_metric_date date, p_location text, p_provider text, p_write_overall_provider boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_categories text[];
  v_members uuid[];
  v_member_categories text[];
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
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text || '|__TRACKING_REPLACEMENT_RECOMPUTE__', 0));
  select array(select t from unnest(p.categories) t where t <> 'Overall') into v_categories
  from public.projects p where p.id = p_project_id;
  if coalesce(cardinality(v_categories), 0) = 0 then return null; end if;

  select array_agg(r.id order by r.category), array_agg(r.category order by r.category)
  into v_members, v_member_categories
  from (
    select distinct on (tr.category) tr.id, tr.category
    from public.tracking_runs tr
    where tr.project_id = p_project_id and tr.provider = p_provider and tr.tracking_location = p_location
      and tr.status = 'completed' and tr.published_at is not null and tr.superseded_at is null
      and tr.run_kind = 'category' and tr.category = any(v_categories)
      and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
    order by tr.category, tr.published_at desc, tr.id desc
  ) r;

  if coalesce(cardinality(v_members), 0) <> cardinality(v_categories) then return null; end if;

  select sum(t.presence_count), sum(t.response_count) into v_pres, v_resp
  from unnest(v_members, v_member_categories) m(run_id, category)
  cross join lateral public.run_tracked_presence(m.run_id, m.category) t;
  if coalesce(v_resp, 0) = 0 then return null; end if;

  -- Reuse the active aggregate when it already pools exactly these member runs.
  select x.id into v_agg
  from public.tracking_runs x
  where x.project_id = p_project_id and x.provider = p_provider and x.tracking_location = p_location
    and x.run_kind = 'overall_aggregate' and x.published_at is not null and x.superseded_at is null
    and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
    and exists (select 1 from public.visibility_daily v
                where v.run_id = x.id and v.category = 'Overall' and v.llm_provider in ('Overall', p_provider)
                  and v.source_run_ids is not distinct from v_members)
  limit 1;

  if v_agg is null then
    update public.tracking_runs set superseded_at = now()
    where project_id = p_project_id and provider = p_provider and tracking_location = p_location
      and run_kind = 'overall_aggregate' and published_at is not null and superseded_at is null
      and (published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date;

    insert into public.tracking_runs (
      project_id, provider, status, total_prompts, completed_prompts, failed_prompts,
      started_at, completed_at, tracking_location, category, published_at, run_kind, supersedes_run_id
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

  insert into public.category_brand_observations (
    project_id, brand_id, category, metric_date, tracking_location, llm_provider,
    presence_count, response_count, mention_count, citation_count, average_position, run_id
  )
  select p_project_id, o.brand_id, 'Overall', p_metric_date, p_location, p_provider,
    sum(o.presence_count), sum(o.response_count), sum(o.mention_count), sum(o.citation_count),
    case when sum(o.presence_count) filter (where o.average_position is not null) > 0
      then round(sum(o.average_position * o.presence_count) filter (where o.average_position is not null)
                 / sum(o.presence_count) filter (where o.average_position is not null), 2) end,
    v_agg
  from public.category_brand_observations o
  join unnest(v_members, v_member_categories) m(run_id, category) on o.run_id = m.run_id and o.category = m.category
  join public.category_brand_assignments a on a.project_id = o.project_id and a.brand_id = o.brand_id
    and a.category = o.category and a.role = 'competitor' and a.include_in_metrics
  where o.project_id = p_project_id and o.llm_provider = p_provider and o.tracking_location = p_location
    and o.response_count > 0
  group by o.brand_id
  on conflict (project_id, brand_id, category, metric_date, tracking_location, llm_provider) do update set
    presence_count = excluded.presence_count, response_count = excluded.response_count,
    mention_count = excluded.mention_count, citation_count = excluded.citation_count,
    average_position = excluded.average_position, run_id = excluded.run_id;

  delete from public.category_brand_observations
  where project_id = p_project_id and category = 'Overall' and metric_date = p_metric_date
    and tracking_location = p_location and llm_provider = p_provider and run_id is distinct from v_agg;

  select * into v_rank from public.canonical_scoped_rank(
    p_project_id, v_agg, 'Overall', p_metric_date, p_provider, p_location, v_pres, v_resp);

  select coalesce(sum(v.citation_count), 0) into v_citations
  from public.visibility_daily v
  join unnest(v_members, v_member_categories) m(run_id, category) on v.run_id = m.run_id and v.category = m.category
  where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
    and v.llm_provider = p_provider;

  select sum(t.total - t.comp), sum(t.total)
  into v_sov_tracked, v_sov_total
  from (
    select (comp.mentions / (1 - v.share_of_voice_score / 100)) as total, comp.mentions as comp
    from public.visibility_daily v
    join unnest(v_members, v_member_categories) m(run_id, category) on v.run_id = m.run_id and v.category = m.category
    cross join lateral (
      select coalesce(sum(o.mention_count), 0)::numeric as mentions from public.category_brand_observations o
      where o.run_id = m.run_id and o.category = m.category and o.llm_provider = p_provider
        and o.tracking_location = p_location and o.metric_date = p_metric_date and o.response_count > 0
        and exists (select 1 from public.category_brand_assignments a
                    where a.project_id = o.project_id and a.brand_id = o.brand_id and a.category = o.category
                      and a.role = 'competitor' and a.include_in_metrics)
    ) comp
    where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
      and v.llm_provider = p_provider and v.share_of_voice_score is not null and v.share_of_voice_score < 100
  ) t;

  v_sov_rank := case when v_sov_total > 0
    then 1 + (select count(*) from public.category_brand_observations o
              where o.run_id = v_agg and o.category = 'Overall' and o.response_count > 0 and o.mention_count > v_sov_tracked)::integer end;

  select sum(v.average_position * t.presence_count) / nullif(sum(t.presence_count), 0)
  into v_tracked_pos
  from public.visibility_daily v
  join unnest(v_members, v_member_categories) m(run_id, category) on v.run_id = m.run_id and v.category = m.category
  cross join lateral public.run_tracked_presence(m.run_id, m.category) t
  where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
    and v.llm_provider = p_provider and v.average_position is not null;
  v_pos_rank := case when v_tracked_pos is not null and exists (
      select 1 from public.category_brand_observations o where o.run_id = v_agg and o.category = 'Overall' and o.average_position is not null)
    then 1 + (select count(*) from public.category_brand_observations o
              where o.run_id = v_agg and o.category = 'Overall' and o.average_position is not null
                and o.average_position < v_tracked_pos)::integer end;

  insert into public.visibility_daily (
    project_id, metric_date, tracking_location, category, llm_provider, run_id,
    visibility_score, visibility_rank, rank_population_count, rank_population_status,
    share_of_voice_score, share_of_voice_rank, average_position, average_position_rank, citation_count,
    presence_count, response_count, source_run_ids, metric_version
  )
  select p_project_id, p_metric_date, p_location, 'Overall', prov, v_agg,
    round(v_pres::numeric / v_resp * 100, 1), v_rank.visibility_rank, v_rank.rank_population_count, v_rank.rank_population_status,
    case when v_sov_total > 0 then round(v_sov_tracked / v_sov_total * 100, 1) end, v_sov_rank,
    case when v_tracked_pos is not null then round(v_tracked_pos, 2) end, v_pos_rank, v_citations,
    v_pres, v_resp, v_members, 'v2'
  from unnest(case when p_write_overall_provider then array['Overall', p_provider] else array[p_provider] end) prov
  on conflict (project_id, metric_date, category, llm_provider, tracking_location) do update set
    run_id = excluded.run_id, visibility_score = excluded.visibility_score, visibility_rank = excluded.visibility_rank,
    rank_population_count = excluded.rank_population_count, rank_population_status = excluded.rank_population_status,
    share_of_voice_score = excluded.share_of_voice_score, share_of_voice_rank = excluded.share_of_voice_rank,
    average_position = excluded.average_position, average_position_rank = excluded.average_position_rank,
    citation_count = excluded.citation_count, presence_count = excluded.presence_count,
    response_count = excluded.response_count, source_run_ids = excluded.source_run_ids,
    metric_version = excluded.metric_version;

  return v_agg;
end;
$function$
;

-- This helper is called only from trusted service-role workflows and other
-- SECURITY DEFINER functions. Do not expose its project-wide rebuild capability
-- through the browser-facing PostgREST API.
REVOKE ALL ON FUNCTION public.publish_engine_overall_metrics(uuid, date, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_engine_overall_metrics(uuid, date, text, text, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.recompute_competitor_metrics(p_project_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '20min'
AS $function$
declare
  v_project public.projects%rowtype;
  v_categories text[];
  v_tracked_id uuid;
  v_tracked_pattern text;
  v_tracked_sites text[];
  fr record;
  tn text;
  ur record;
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
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text || '|__TRACKING_REPLACEMENT_RECOMPUTE__', 0));
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'project % not found', p_project_id; end if;
  v_categories := array(select x from unnest(v_project.categories) x where x <> 'Overall');
  if coalesce(cardinality(v_categories), 0) = 0 then
    return jsonb_build_object('status', 'skipped', 'reason', 'project has no categories');
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

  select array(select distinct public.site_host(w) from unnest(
           coalesce(v_project.brand_domains, '{}') || array[b.primary_website] || coalesce(b.additional_websites, '{}')) w
         where public.site_host(w) is not null)
  into v_tracked_sites
  from public.brand_registry b
  where b.project_id = p_project_id and b.is_tracked_brand and b.is_active
  limit 1;

  -- 1. Republish verifiable per-category slices of older all-category runs.
  for fr in
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
        where x.project_id = tr.project_id and x.run_kind = 'category' and x.source_run_id is null
          and x.status = 'completed' and x.published_at is not null and x.superseded_at is null
          and x.tracking_location = tr.tracking_location and x.provider = tr.provider
          and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = tr.d)
    order by tr.d, tr.tracking_location, tr.provider, tr.completed_at desc
  loop
    foreach tn in array v_categories loop
      if exists (select 1 from public.tracking_runs x
                 where x.source_run_id = fr.id and x.category = tn and x.published_at is not null and x.superseded_at is null) then
        continue;
      end if;
      select p.presence_count, p.response_count into v_pres, v_resp from public.run_tracked_presence(fr.id, tn) p;
      select v.visibility_score into v_score from public.visibility_daily v
      where v.project_id = p_project_id and v.metric_date = fr.d and v.category = tn
        and v.llm_provider = 'Overall' and v.tracking_location = fr.tracking_location;
      if coalesce(v_resp, 0) > 0 and v_score is not null
         and abs(round(v_pres::numeric / v_resp * 100, 1) - v_score) <= 0.05 then
        insert into public.tracking_runs (
          project_id, provider, status, total_prompts, completed_prompts, failed_prompts, started_at, completed_at,
          tracking_location, category, published_at, run_kind, source_run_id, error_message)
        values (p_project_id, fr.provider, 'completed', v_resp, v_resp, 0, fr.started_at, fr.completed_at,
          fr.tracking_location, tn, fr.completed_at, 'category', fr.id, 'Backfilled category slice of all-category run ' || fr.id)
        returning id into v_synth;
        update public.visibility_daily set run_id = v_synth
        where project_id = p_project_id and metric_date = fr.d and category = tn
          and tracking_location = fr.tracking_location and llm_provider in ('Overall', 'chatgpt');
        v_slices := v_slices + 1;
      else
        v_skipped := v_skipped || jsonb_build_object(
          'date', fr.d, 'category', tn, 'stored_score', v_score,
          'recomputed', case when coalesce(v_resp, 0) > 0 then round(v_pres::numeric / v_resp * 100, 1) end);
      end if;
    end loop;
  end loop;

  -- 2. Units = published category runs (real or backfilled slices) in range.
  -- Temp tables are transaction-scoped; process one project per transaction.
  create temp table _cm_units on commit drop as
  select tr.id as unit_run, coalesce(tr.source_run_id, tr.id) as src_run, tr.category, tr.tracking_location as loc,
         tr.provider, (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date as d
  from public.tracking_runs tr
  where tr.project_id = p_project_id and tr.run_kind = 'category' and tr.status = 'completed'
    and tr.published_at is not null and tr.superseded_at is null and tr.provider <> 'Overall'
    and tr.category = any(v_categories)
    and (p_date_from is null or (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date >= p_date_from)
    and (p_date_to is null or (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date <= p_date_to);

  create temp table _cm_resp on commit drop as
  select distinct on (u.unit_run, ar.prompt_id) u.unit_run, u.src_run, u.category, u.loc, u.d, u.provider,
         ar.id as response_id, ar.response_text, ar.raw_response
  from _cm_units u
  join public.ai_responses ar on ar.run_id = u.src_run and ar.response_status = 'completed'
    and coalesce(btrim(ar.response_text), '') <> ''
  join public.prompts p on p.id = ar.prompt_id and p.category = u.category
  order by u.unit_run, ar.prompt_id, ar.captured_at desc, ar.id desc;
  create index on _cm_resp (unit_run);

  create temp table _cm_entities on commit drop as
  select * from public.competitor_entities(p_project_id) e where e.pattern is not null and e.category = any(v_categories);
  select count(distinct brand_id) into v_entities from _cm_entities;

  -- 3a. Text matches (competitors) plus the tracked brand for position ordering.
  create temp table _cm_hits on commit drop as
  select r.unit_run, r.response_id, e.brand_id, false as is_tracked,
         regexp_count(r.response_text, e.pattern, 1, 'i') as n,
         regexp_instr(r.response_text, e.pattern, 1, 1, 0, 'i') as pos
  from _cm_resp r
  join _cm_entities e on e.category = r.category and r.response_text ~* e.pattern;
  if v_tracked_pattern is not null then
    insert into _cm_hits
    select r.unit_run, r.response_id, v_tracked_id, true,
           regexp_count(r.response_text, v_tracked_pattern, 1, 'i'),
           regexp_instr(r.response_text, v_tracked_pattern, 1, 1, 0, 'i')
    from _cm_resp r where r.response_text ~* v_tracked_pattern
      and not exists (select 1 from public.tracking_runs tx where tx.id = r.unit_run and tx.data_source = 'profound_import');
    -- Imported runs: the tracked brand's presence is the stored evidence (it may come from the source's own flag).
    insert into _cm_hits
    select r.unit_run, r.response_id, v_tracked_id, true, e.occurrence_count, e.first_position + 1
    from _cm_resp r
    join public.response_brand_evidence e on e.response_id = r.response_id and e.brand_id = v_tracked_id and e.match_source = 'response_text'
    where exists (select 1 from public.tracking_runs tx where tx.id = r.unit_run and tx.data_source = 'profound_import');
  end if;

  -- 3b. Evidence for the current competitor set (response-text matches).
  insert into public.response_brand_evidence (
    project_id, response_id, brand_id, category, match_source, matched_value, evidence_text,
    first_position, occurrence_count, confidence)
  select p_project_id, h.response_id, h.brand_id, e.category, 'response_text', e.canonical_name,
         substr(r.response_text, greatest(1, h.pos - 80), 260), h.pos - 1, h.n, 'deterministic'
  from _cm_hits h
  join _cm_resp r on r.response_id = h.response_id and r.unit_run = h.unit_run
  join _cm_entities e on e.brand_id = h.brand_id and e.category = r.category
  where not h.is_tracked
  on conflict (response_id, brand_id, category, match_source, matched_value) do update set
    evidence_text = excluded.evidence_text, first_position = excluded.first_position,
    occurrence_count = excluded.occurrence_count;
  get diagnostics v_evidence = row_count;

  -- 3c. Citation occurrences: cited URLs (url_citation annotations) attributed by domain to each entity.
  -- Competitors are rebuilt for their current set. The tracked brand is rebuilt only where it has no normalized
  -- occurrences yet (older days), so already-correct tracked counts are left untouched.
  create temp table _cm_cit_entities on commit drop as
  select e.category, e.brand_id, e.websites, false as is_tracked from _cm_entities e
  union all
  select tp.category_name, v_tracked_id, coalesce(v_tracked_sites, '{}'), true
  from unnest(v_categories) as tp(category_name) where v_tracked_id is not null;

  create temp table _cm_tracked_missing on commit drop as
  select u.unit_run from _cm_units u
  where v_tracked_id is not null and not exists (
    select 1 from public.citation_occurrences co join _cm_resp r on r.response_id = co.response_id
    where r.unit_run = u.unit_run and co.entity_id = v_tracked_id);

  create temp table _cm_cit on commit drop as
  select distinct r.unit_run, r.src_run, r.response_id, r.category, r.loc, r.d, r.provider, e.brand_id, e.is_tracked,
         cu.url as citation_url, public.canonicalize_citation_url(cu.url) as canonical_url,
         lower(split_part(split_part(regexp_replace(public.canonicalize_citation_url(cu.url), '^https?://', '', 'i'), '/', 1), ':', 1)) as host
  from _cm_resp r
  cross join lateral (
    select a ->> 'url' as url
    from jsonb_path_query(r.raw_response, '$.output[*].content[*].annotations[*] ? (@.type == "url_citation")') a
  ) cu
  join _cm_cit_entities e on e.category = r.category
  where cu.url ~* '^https?://'
    and (not e.is_tracked or r.unit_run in (select unit_run from _cm_tracked_missing))
    and exists (select 1 from unnest(e.websites) w
                where lower(split_part(split_part(regexp_replace(public.canonicalize_citation_url(cu.url), '^https?://', '', 'i'), '/', 1), ':', 1)) = w
                   or lower(split_part(split_part(regexp_replace(public.canonicalize_citation_url(cu.url), '^https?://', '', 'i'), '/', 1), ':', 1)) like '%.' || w);

  delete from public.citation_occurrences co
  using _cm_resp r, _cm_entities e
  where co.response_id = r.response_id and co.entity_id = e.brand_id and e.category = r.category;
  insert into public.citation_occurrences (
    project_id, response_id, entity_id, category, metric_date, provider, tracking_location, run_id,
    citation_url, canonical_url, canonical_domain, citation_index)
  select distinct on (response_id, brand_id, canonical_url)
         p_project_id, response_id, brand_id, category, d, provider, loc, src_run, citation_url, canonical_url, host, 1
  from _cm_cit
  order by response_id, brand_id, canonical_url, citation_url
  on conflict (response_id, entity_id, canonical_url) do nothing;
  get diagnostics v_citations = row_count;

  -- Tracked-brand daily citation count for the units that were just (re)built.
  update public.visibility_daily v set citation_count = x.n
  from (select m.unit_run, count(distinct c.response_id::text || '|' || c.canonical_url)::integer as n  -- NULL-safe: a unit with no tracked citations counts 0, not 1
        from _cm_tracked_missing m
        left join _cm_cit c on c.unit_run = m.unit_run and c.is_tracked
        group by m.unit_run) x
  where v.run_id = x.unit_run;

  -- 3d. Competitor observations for every unit (zero-presence competitors included).
  insert into public.category_brand_observations (
    project_id, brand_id, category, metric_date, tracking_location, llm_provider,
    presence_count, response_count, mention_count, citation_count, average_position, run_id)
  select p_project_id, e.brand_id, u.category, u.d, u.loc, u.provider,
         coalesce(h.presence, 0), rc.n, coalesce(h.mentions, 0), coalesce(cc.n, 0), ap.avg_pos, u.unit_run
  from _cm_units u
  join (select unit_run, count(*)::integer as n from _cm_resp group by unit_run) rc on rc.unit_run = u.unit_run
  join _cm_entities e on e.category = u.category
  left join (select unit_run, brand_id, count(*)::integer as presence, sum(n)::integer as mentions
             from _cm_hits where not is_tracked group by unit_run, brand_id) h
         on h.unit_run = u.unit_run and h.brand_id = e.brand_id
  left join (select unit_run, brand_id, count(distinct (response_id, canonical_url))::integer as n
             from _cm_cit where not is_tracked group by unit_run, brand_id) cc
         on cc.unit_run = u.unit_run and cc.brand_id = e.brand_id
  left join (select unit_run, brand_id, round(avg(rk)::numeric, 2) as avg_pos
             from (select unit_run, brand_id,
                          row_number() over (partition by response_id order by pos, is_tracked desc, brand_id) as rk
                   from _cm_hits) z group by unit_run, brand_id) ap
         on ap.unit_run = u.unit_run and ap.brand_id = e.brand_id
  on conflict (project_id, brand_id, category, metric_date, tracking_location, llm_provider) do update set
    presence_count = excluded.presence_count, response_count = excluded.response_count,
    mention_count = excluded.mention_count, citation_count = excluded.citation_count,
    average_position = excluded.average_position, run_id = excluded.run_id;
  get diagnostics v_obs = row_count;

  -- 3e. Archive then remove derived observations of brands that are no longer competitors in these scopes.
  insert into public.category_brand_observations_archive
  select o.*, now(), 'competitor set replaced'
  from public.category_brand_observations o
  join _cm_units u on u.category = o.category and u.d = o.metric_date and u.loc = o.tracking_location and u.provider = o.llm_provider
  where o.project_id = p_project_id
    and not exists (select 1 from _cm_entities e where e.category = o.category and e.brand_id = o.brand_id);
  get diagnostics v_archived = row_count;
  delete from public.category_brand_observations o
  using _cm_units u
  where o.project_id = p_project_id and u.category = o.category and u.d = o.metric_date
    and u.loc = o.tracking_location and u.provider = o.llm_provider
    and not exists (select 1 from _cm_entities e where e.category = o.category and e.brand_id = o.brand_id);

  -- 3f. Tracked-brand share of voice and position for imported daily rows that have none yet.
  update public.visibility_daily v set
    share_of_voice_score = x.sov, share_of_voice_rank = x.sov_rank,
    average_position = x.pos, average_position_rank = x.pos_rank
  from (
    select u.unit_run,
           case when t.total > 0 then round(t.mine::numeric / t.total * 100, 1) else 0 end as sov,
           1 + (select count(*) from public.category_brand_observations o
                where o.run_id = u.unit_run and o.category = u.category and o.response_count > 0 and o.mention_count > t.mine)::integer as sov_rank,
           tp.avg_pos as pos,
           case when tp.avg_pos is not null and exists (
                  select 1 from public.category_brand_observations o
                  where o.run_id = u.unit_run and o.category = u.category and o.average_position is not null)
                then 1 + (select count(*) from public.category_brand_observations o
                          where o.run_id = u.unit_run and o.category = u.category and o.average_position is not null
                            and o.average_position < tp.avg_pos)::integer end as pos_rank
    from _cm_units u
    cross join lateral (select coalesce(sum(h.n) filter (where h.is_tracked), 0) as mine, coalesce(sum(h.n), 0) as total
                        from _cm_hits h where h.unit_run = u.unit_run) t
    left join lateral (
      select round(avg(z.rk)::numeric, 2) as avg_pos
      from (select row_number() over (partition by hh.response_id order by hh.pos, hh.is_tracked desc, hh.brand_id) as rk, hh.is_tracked, hh.pos
            from _cm_hits hh where hh.unit_run = u.unit_run) z
      where z.is_tracked and z.pos is not null) tp on true
    where exists (select 1 from public.tracking_runs t2 where t2.id = u.unit_run and t2.data_source = 'profound_import')
  ) x
  where v.run_id = x.unit_run and v.share_of_voice_score is null;

  -- 4. Rank + population via the canonical implementation; a unit whose tracked score no longer reproduces is reported.
  for ur in select * from _cm_units order by d, category loop
    begin
      perform public.finalize_run_metrics(ur.unit_run);
      v_units := v_units + 1;
    exception when others then
      v_blocked := v_blocked || jsonb_build_object('date', ur.d, 'category', ur.category, 'reason', sqlerrm);
    end;
  end loop;

  -- 5. Overall pools the category runs of each day.
  for ur in select distinct d, loc, provider from _cm_units order by d loop
    if public.publish_engine_overall_metrics(p_project_id, ur.d, ur.loc, ur.provider, not exists (
        select 1 from public.tracking_runs tx
        where tx.project_id = p_project_id and tx.tracking_location = ur.loc and tx.run_kind = 'category'
          and tx.status = 'completed' and tx.published_at is not null and tx.superseded_at is null
          and tx.provider <> 'Overall' and tx.provider <> ur.provider
          and (tx.published_at at time zone 'Asia/Kuala_Lumpur')::date = ur.d)) is not null then
      v_overall := v_overall + 1;
    end if;
    -- Days with several engines are also pooled across engines (idempotent per day).
    if exists (select 1 from public.tracking_runs tx
               where tx.project_id = p_project_id and tx.tracking_location = ur.loc and tx.run_kind = 'category'
                 and tx.status = 'completed' and tx.published_at is not null and tx.superseded_at is null
                 and tx.provider <> 'Overall' and tx.provider <> ur.provider
                 and (tx.published_at at time zone 'Asia/Kuala_Lumpur')::date = ur.d) then
      perform public.publish_cross_engine_metrics(p_project_id, ur.d, ur.loc);
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'completed', 'competitors', v_entities, 'slices_backfilled', v_slices,
    'units_finalized', v_units, 'overall_days', v_overall,
    'observations_written', v_obs, 'evidence_rows', v_evidence, 'citation_occurrences_added', v_citations,
    'observations_archived', v_archived, 'slices_unverified', v_skipped, 'units_blocked', v_blocked);
end;
$function$
;
