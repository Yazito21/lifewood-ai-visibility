-- Multi-engine metrics and the Profound import.
--
-- 1. profound_import_rows: staging area for cleaned Profound exports (scripts/profound-import/clean_profound_export.py).
-- 2. tracking_runs/ai_responses.data_source and tracking_runs.import_batch mark imported data; the provider check also
--    allows 'Overall' for pooled cross-engine aggregate runs.
-- 3. publish_engine_overall_metrics: the per-engine Overall pool (publish_overall_metrics is now a thin wrapper).
-- 4. publish_cross_engine_metrics: the 'Overall' provider rows for days that have several engines.
-- 5. recompute_competitor_metrics: no longer ChatGPT-only; imported runs get share of voice/position and take the
--    tracked brand's presence from stored evidence; multi-engine days are pooled across engines.
-- 6. import_profound_batch: loads one staged batch.
-- Single-engine projects (every other project today) keep exactly their previous behaviour.

create table if not exists public.profound_import_rows (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  batch text not null,
  profound_run_id text not null,
  run_date date not null,
  engine text not null check (engine in ('chatgpt','gemini','perplexity','google_ai_overview','claude')),
  profound_topic text,
  prompt text not null,
  row_seq integer not null default 1,
  response_status text not null check (response_status in ('completed','failed')),
  response_text text not null default '',
  cited_urls text[] not null default '{}',
  meta jsonb not null default '{}'::jsonb,
  profound_mentioned boolean,
  profound_position integer,
  profound_mentions text[] not null default '{}',
  loaded_at timestamptz not null default now(),
  unique (project_id, profound_run_id)
);
comment on table public.profound_import_rows is 'Staging area for cleaned Profound exports. Rows are turned into ai_responses/tracking_runs by import_profound_batch(); safe to truncate after a batch is imported.';
create index if not exists profound_import_rows_batch_idx on public.profound_import_rows (project_id, batch, run_date, engine);
alter table public.profound_import_rows enable row level security;
grant all on public.profound_import_rows to service_role;
grant usage, select on sequence public.profound_import_rows_id_seq to service_role;

alter table public.tracking_runs add column if not exists data_source text;
alter table public.tracking_runs add column if not exists import_batch text;
alter table public.ai_responses add column if not exists data_source text;
comment on column public.tracking_runs.data_source is 'Where the run came from: null for platform runs, profound_import for imported Profound exports, cross_engine_pool for pooled aggregates.';
comment on column public.tracking_runs.import_batch is 'Import batch label for data_source = profound_import.';
alter table public.tracking_runs drop constraint tracking_runs_provider_check;
alter table public.tracking_runs add constraint tracking_runs_provider_check
  check (provider = any (array['chatgpt'::text, 'gemini'::text, 'perplexity'::text, 'google_ai_overview'::text, 'claude'::text, 'Overall'::text]));

-- 3. Per-engine Overall: the same pooled calculation as before, optionally without the 'Overall' provider row.
do $patch$
declare
  d text;
  pairs text[][] := array[
    [$a$CREATE OR REPLACE FUNCTION public.publish_overall_metrics(p_project_id uuid, p_metric_date date, p_location text, p_provider text DEFAULT 'chatgpt'::text)$a$,
     $a$CREATE OR REPLACE FUNCTION public.publish_engine_overall_metrics(p_project_id uuid, p_metric_date date, p_location text, p_provider text, p_write_overall_provider boolean)$a$],
    [$a$v.topic = 'Overall' and v.llm_provider = 'Overall'$a$, $a$v.topic = 'Overall' and v.llm_provider in ('Overall', p_provider)$a$],
    [$a$from unnest(array['Overall', p_provider]) prov$a$, $a$from unnest(case when p_write_overall_provider then array['Overall', p_provider] else array[p_provider] end) prov$a$]
  ];
  i int;
begin
  d := pg_get_functiondef('public.publish_overall_metrics(uuid,date,text,text)'::regprocedure);
  for i in 1..array_length(pairs, 1) loop
    if position(pairs[i][1] in d) = 0 then raise exception 'patch % not found', i; end if;
    d := replace(d, pairs[i][1], pairs[i][2]);
  end loop;
  execute d;
end
$patch$;

-- On multi-engine days the 'Overall' provider rows are pooled across engines, so the per-engine pool reads its own engine's rows.
do $patch$
declare d text; n int;
begin
  d := pg_get_functiondef('public.publish_engine_overall_metrics(uuid,date,text,text,boolean)'::regprocedure);
  n := (length(d) - length(replace(d, $a$v.llm_provider = 'Overall'$a$, ''))) / length($a$v.llm_provider = 'Overall'$a$);
  if n <> 3 then raise exception 'expected 3 occurrences, found %', n; end if;
  d := replace(d, $a$v.llm_provider = 'Overall'$a$, $a$v.llm_provider = p_provider$a$);
  execute d;
end
$patch$;

create or replace function public.publish_overall_metrics(
  p_project_id uuid, p_metric_date date, p_location text, p_provider text default 'chatgpt'
) returns uuid
language sql security definer set search_path = public as $$
  select public.publish_engine_overall_metrics(p_project_id, p_metric_date, p_location, p_provider, true)
$$;

revoke all on function public.publish_engine_overall_metrics(uuid, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.publish_engine_overall_metrics(uuid, date, text, text, boolean) to service_role;
revoke all on function public.publish_overall_metrics(uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.publish_overall_metrics(uuid, date, text, text) to service_role;

-- 4. Cross-engine pooling.
-- Overall provider rows for days that have several engines.
-- Each engine keeps its own rows (llm_provider = engine). The 'Overall' provider rows pool the same day's
-- published topic runs of every engine, per topic and for the topic 'Overall'. Everything is derived from the
-- stored responses, evidence and competitor observations; nothing is averaged from rounded scores.
create or replace function public.publish_cross_engine_metrics(
  p_project_id uuid, p_metric_date date, p_location text
) returns uuid
language plpgsql security definer set search_path = public set statement_timeout = '10min' as $$
declare
  v_topics text[];
  v_tracked_id uuid;
  sc text;
  v_members uuid[];
  v_member_topics text[];
  v_member_providers text[];
  v_agg uuid;
  v_last uuid;
  v_pres integer;
  v_resp integer;
  v_rank record;
  v_mine numeric;
  v_comp numeric;
  v_sov numeric;
  v_sov_rank integer;
  v_pos numeric;
  v_pos_rank integer;
  v_citations integer;
  v_ret uuid;
begin
  select array(select t from unnest(p.topics) t where t <> 'Overall') into v_topics
  from public.projects p where p.id = p_project_id;
  if coalesce(cardinality(v_topics), 0) = 0 then return null; end if;
  select b.id into v_tracked_id from public.brand_registry b
  where b.project_id = p_project_id and b.is_tracked_brand and b.is_active limit 1;
  if v_tracked_id is null then return null; end if;

  foreach sc in array (v_topics || array['Overall']) loop
    select array_agg(r.id order by r.provider, r.topic), array_agg(r.topic order by r.provider, r.topic),
           array_agg(r.provider order by r.provider, r.topic)
    into v_members, v_member_topics, v_member_providers
    from (
      select distinct on (tr.provider, tr.topic) tr.id, tr.topic, tr.provider
      from public.tracking_runs tr
      where tr.project_id = p_project_id and tr.tracking_location = p_location
        and tr.status = 'completed' and tr.published_at is not null and tr.superseded_at is null
        and tr.run_kind = 'topic' and tr.provider <> 'Overall' and tr.topic = any(v_topics)
        and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
        and (sc = 'Overall' or tr.topic = sc)
      order by tr.provider, tr.topic, tr.published_at desc, tr.id desc
    ) r;
    if coalesce(cardinality(v_members), 0) = 0 then continue; end if;
    -- A pooled Overall needs every topic represented by at least one engine.
    if sc = 'Overall' and (select count(distinct t) from unnest(v_member_topics) t) <> cardinality(v_topics) then continue; end if;

    select sum(t.presence_count), sum(t.response_count) into v_pres, v_resp
    from unnest(v_members, v_member_topics) m(run_id, topic)
    cross join lateral public.run_tracked_presence(m.run_id, m.topic) t;
    if coalesce(v_resp, 0) = 0 then continue; end if;

    -- Reuse the active aggregate when it already pools exactly these runs; otherwise retire it and record a new one.
    select x.id into v_agg
    from public.tracking_runs x
    where x.project_id = p_project_id and x.provider = 'Overall' and x.tracking_location = p_location
      and x.run_kind = 'overall_aggregate' and x.published_at is not null and x.superseded_at is null
      and coalesce(x.topic, '') = case when sc = 'Overall' then '' else sc end
      and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
      and exists (select 1 from public.visibility_daily v
                  where v.run_id = x.id and v.topic = sc and v.llm_provider = 'Overall'
                    and v.source_run_ids is not distinct from v_members)
    limit 1;
    if v_agg is null then
      select x.id into v_last from public.tracking_runs x
      where x.project_id = p_project_id and x.provider = 'Overall' and x.tracking_location = p_location
        and x.run_kind = 'overall_aggregate' and coalesce(x.topic, '') = case when sc = 'Overall' then '' else sc end
        and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
      order by x.superseded_at desc nulls last, x.published_at desc limit 1;
      update public.tracking_runs set superseded_at = now()
      where project_id = p_project_id and provider = 'Overall' and tracking_location = p_location
        and run_kind = 'overall_aggregate' and published_at is not null and superseded_at is null
        and coalesce(topic, '') = case when sc = 'Overall' then '' else sc end
        and (published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date;
      insert into public.tracking_runs (
        project_id, provider, status, total_prompts, completed_prompts, failed_prompts, started_at, completed_at,
        tracking_location, topic, published_at, run_kind, supersedes_run_id, data_source)
      select p_project_id, 'Overall', 'completed', sum(total_prompts), sum(completed_prompts), 0, min(started_at), max(completed_at),
             p_location, case when sc = 'Overall' then null else sc end, max(published_at), 'overall_aggregate', v_last, 'cross_engine_pool'
      from public.tracking_runs where id = any(v_members)
      returning id into v_agg;
    end if;

    -- Pooled competitor observations: presence and responses summed over the member engine runs.
    insert into public.topic_brand_observations (
      project_id, brand_id, topic, metric_date, tracking_location, llm_provider,
      presence_count, response_count, mention_count, citation_count, average_position, run_id)
    select p_project_id, o.brand_id, sc, p_metric_date, p_location, 'Overall',
           sum(o.presence_count), sum(o.response_count), sum(o.mention_count), sum(o.citation_count),
           case when sum(o.presence_count) filter (where o.average_position is not null) > 0
                then round(sum(o.average_position * o.presence_count) filter (where o.average_position is not null)
                           / sum(o.presence_count) filter (where o.average_position is not null), 2) end,
           v_agg
    from public.topic_brand_observations o
    join unnest(v_members, v_member_topics, v_member_providers) m(run_id, topic, provider)
      on o.run_id = m.run_id and o.topic = m.topic and o.llm_provider = m.provider
    join public.topic_brand_assignments a on a.project_id = o.project_id and a.brand_id = o.brand_id
      and a.topic = o.topic and a.role = 'competitor' and a.include_in_metrics
    where o.project_id = p_project_id and o.tracking_location = p_location and o.response_count > 0
    group by o.brand_id
    on conflict (project_id, brand_id, topic, metric_date, tracking_location, llm_provider) do update set
      presence_count = excluded.presence_count, response_count = excluded.response_count,
      mention_count = excluded.mention_count, citation_count = excluded.citation_count,
      average_position = excluded.average_position, run_id = excluded.run_id;
    delete from public.topic_brand_observations
    where project_id = p_project_id and topic = sc and metric_date = p_metric_date
      and tracking_location = p_location and llm_provider = 'Overall' and run_id is distinct from v_agg;

    select * into v_rank from public.canonical_scoped_rank(
      p_project_id, v_agg, sc, p_metric_date, 'Overall', p_location, v_pres, v_resp);

    -- Tracked-brand mentions and position come from the stored evidence of the pooled responses.
    select coalesce(sum(e.occurrence_count), 0) into v_mine
    from public.response_brand_evidence e
    join public.ai_responses ar on ar.id = e.response_id and ar.response_status = 'completed'
    join public.prompts pr on pr.id = ar.prompt_id
    join (select distinct mm.run_id, mm.topic,
                 coalesce((select t.source_run_id from public.tracking_runs t where t.id = mm.run_id), mm.run_id) as src
          from unnest(v_members, v_member_topics) mm(run_id, topic)) m on ar.run_id = m.src and pr.topic = m.topic
    where e.brand_id = v_tracked_id and e.match_source = 'response_text';

    select coalesce(sum(o.mention_count), 0) into v_comp
    from public.topic_brand_observations o where o.run_id = v_agg and o.topic = sc and o.response_count > 0;
    v_sov := case when v_mine + v_comp > 0 then round(v_mine / (v_mine + v_comp) * 100, 1) else 0 end;
    v_sov_rank := 1 + (select count(*) from public.topic_brand_observations o
                       where o.run_id = v_agg and o.topic = sc and o.response_count > 0 and o.mention_count > v_mine)::integer;

    select round(avg(z.rk)::numeric, 2) into v_pos
    from (
      select 1 + (select count(*) from public.response_brand_evidence c
                  where c.response_id = e.response_id and c.match_source = 'response_text'
                    and c.brand_id <> v_tracked_id and c.first_position < e.first_position) as rk
      from public.response_brand_evidence e
      join public.ai_responses ar on ar.id = e.response_id and ar.response_status = 'completed'
      join public.prompts pr on pr.id = ar.prompt_id
      join (select distinct mm.run_id, mm.topic,
                   coalesce((select t.source_run_id from public.tracking_runs t where t.id = mm.run_id), mm.run_id) as src
            from unnest(v_members, v_member_topics) mm(run_id, topic)) m on ar.run_id = m.src and pr.topic = m.topic
      where e.brand_id = v_tracked_id and e.match_source = 'response_text' and e.first_position is not null
    ) z;
    v_pos_rank := case when v_pos is not null and exists (
        select 1 from public.topic_brand_observations o where o.run_id = v_agg and o.topic = sc and o.average_position is not null)
      then 1 + (select count(*) from public.topic_brand_observations o
                where o.run_id = v_agg and o.topic = sc and o.average_position is not null and o.average_position < v_pos)::integer end;

    select coalesce(sum(v.citation_count), 0) into v_citations
    from public.visibility_daily v
    join unnest(v_members, v_member_topics, v_member_providers) m(run_id, topic, provider)
      on v.run_id = m.run_id and v.topic = m.topic and v.llm_provider = m.provider
    where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location;

    insert into public.visibility_daily (
      project_id, metric_date, tracking_location, topic, llm_provider, run_id,
      visibility_score, visibility_rank, rank_population_count, rank_population_status,
      share_of_voice_score, share_of_voice_rank, average_position, average_position_rank, citation_count,
      presence_count, response_count, source_run_ids, metric_version)
    values (
      p_project_id, p_metric_date, p_location, sc, 'Overall', v_agg,
      round(v_pres::numeric / v_resp * 100, 1), v_rank.visibility_rank, v_rank.rank_population_count, v_rank.rank_population_status,
      v_sov, v_sov_rank, v_pos, v_pos_rank, v_citations, v_pres, v_resp, v_members, 'v2')
    on conflict (project_id, metric_date, topic, llm_provider, tracking_location) do update set
      run_id = excluded.run_id, visibility_score = excluded.visibility_score, visibility_rank = excluded.visibility_rank,
      rank_population_count = excluded.rank_population_count, rank_population_status = excluded.rank_population_status,
      share_of_voice_score = excluded.share_of_voice_score, share_of_voice_rank = excluded.share_of_voice_rank,
      average_position = excluded.average_position, average_position_rank = excluded.average_position_rank,
      citation_count = excluded.citation_count, presence_count = excluded.presence_count,
      response_count = excluded.response_count, source_run_ids = excluded.source_run_ids,
      metric_version = excluded.metric_version;
    if sc = 'Overall' then v_ret := v_agg; end if;
    v_agg := null;
  end loop;
  return v_ret;
end;
$$;

revoke all on function public.publish_cross_engine_metrics(uuid, date, text) from public, anon, authenticated;
grant execute on function public.publish_cross_engine_metrics(uuid, date, text) to service_role;

-- 5. recompute_competitor_metrics: engine-agnostic, imported-run share of voice / position, cross-engine pooling.
do $patch$
declare
  d text;
  pairs text[][] := array[
    [$a$and tr.published_at is not null and tr.superseded_at is null and tr.provider = 'chatgpt'$a$,
     $a$and tr.published_at is not null and tr.superseded_at is null and tr.provider <> 'Overall'$a$],
    [$a$where v.run_id = x.unit_run and v.llm_provider in ('Overall', 'chatgpt');$a$,
     $a$where v.run_id = x.unit_run;$a$],
    [$a$from _cm_resp r where r.response_text ~* v_tracked_pattern;$a$,
     $a$from _cm_resp r where r.response_text ~* v_tracked_pattern
      and not exists (select 1 from public.tracking_runs tx where tx.id = r.unit_run and tx.data_source = 'profound_import');
    -- Imported runs: the tracked brand's presence is the stored evidence (it may come from the source's own flag).
    insert into _cm_hits
    select r.unit_run, r.response_id, v_tracked_id, true, e.occurrence_count, e.first_position + 1
    from _cm_resp r
    join public.response_brand_evidence e on e.response_id = r.response_id and e.brand_id = v_tracked_id and e.match_source = 'response_text'
    where exists (select 1 from public.tracking_runs tx where tx.id = r.unit_run and tx.data_source = 'profound_import');$a$],
    [$a$-- 4. Rank + population via the canonical implementation;$a$,
     $a$-- 3f. Tracked-brand share of voice and position for imported daily rows that have none yet.
  update public.visibility_daily v set
    share_of_voice_score = x.sov, share_of_voice_rank = x.sov_rank,
    average_position = x.pos, average_position_rank = x.pos_rank
  from (
    select u.unit_run,
           case when t.total > 0 then round(t.mine::numeric / t.total * 100, 1) else 0 end as sov,
           1 + (select count(*) from public.topic_brand_observations o
                where o.run_id = u.unit_run and o.topic = u.topic and o.response_count > 0 and o.mention_count > t.mine)::integer as sov_rank,
           tp.avg_pos as pos,
           case when tp.avg_pos is not null and exists (
                  select 1 from public.topic_brand_observations o
                  where o.run_id = u.unit_run and o.topic = u.topic and o.average_position is not null)
                then 1 + (select count(*) from public.topic_brand_observations o
                          where o.run_id = u.unit_run and o.topic = u.topic and o.average_position is not null
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

  -- 4. Rank + population via the canonical implementation;$a$],
    [$a$if public.publish_overall_metrics(p_project_id, ur.d, ur.loc, ur.provider) is not null then$a$,
     $a$if public.publish_engine_overall_metrics(p_project_id, ur.d, ur.loc, ur.provider, not exists (
        select 1 from public.tracking_runs tx
        where tx.project_id = p_project_id and tx.tracking_location = ur.loc and tx.run_kind = 'topic'
          and tx.status = 'completed' and tx.published_at is not null and tx.superseded_at is null
          and tx.provider <> 'Overall' and tx.provider <> ur.provider
          and (tx.published_at at time zone 'Asia/Kuala_Lumpur')::date = ur.d)) is not null then$a$],
    [$a$v_overall := v_overall + 1;$a$,
     $a$v_overall := v_overall + 1;
    end if;
    -- Days with several engines are also pooled across engines (idempotent per day).
    if exists (select 1 from public.tracking_runs tx
               where tx.project_id = p_project_id and tx.tracking_location = ur.loc and tx.run_kind = 'topic'
                 and tx.status = 'completed' and tx.published_at is not null and tx.superseded_at is null
                 and tx.provider <> 'Overall' and tx.provider <> ur.provider
                 and (tx.published_at at time zone 'Asia/Kuala_Lumpur')::date = ur.d) then
      perform public.publish_cross_engine_metrics(p_project_id, ur.d, ur.loc);$a$]
  ];
  i int;
begin
  d := pg_get_functiondef('public.recompute_competitor_metrics(uuid,date,date)'::regprocedure);
  for i in 1..array_length(pairs, 1) loop
    if position(pairs[i][1] in d) = 0 then raise exception 'patch % not found', i; end if;
    d := replace(d, pairs[i][1], pairs[i][2]);
  end loop;
  execute d;
end
$patch$;

-- 6. Profound import.
-- import_profound_batch: turns cleaned Profound rows (profound_import_rows) into platform-native raw data.
--   * one tracking run per date x engine x topic; ai_responses in the platform's raw-response shape
--   * tracked-brand evidence: p_presence_source 'profound' follows Profound's own "mentioned?" flag,
--     'text' uses the platform's whole-token matcher on the cleaned response text
--   * competitor evidence, observations, ranks, share of voice, position and Overall pooling via recompute_competitor_metrics()
--   * citations rows for the Citations page and the Dashboard
-- Engine days that already have a published platform run are skipped unless p_replace_existing is true
-- (the platform runs are then superseded, never deleted).
drop function if exists public.import_profound_batch(uuid, text, boolean);
create or replace function public.import_profound_batch(
  p_project_id uuid, p_batch text, p_replace_existing boolean default false, p_presence_source text default 'profound'
) returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '30min' as $$
declare
  v_project public.projects%rowtype;
  v_loc text;
  v_tracked_id uuid;
  v_tracked_name text;
  v_pattern text;
  v_unmatched integer;
  v_skipped jsonb;
  v_runs integer;
  v_resp integer;
  v_evidence integer;
  v_citations integer;
  v_dmin date;
  v_dmax date;
  v_engine jsonb;
begin
  if p_presence_source not in ('profound', 'text') then raise exception 'presence source must be profound or text'; end if;
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'project % not found', p_project_id; end if;
  v_loc := coalesce(v_project.tracking_market, 'GLOBAL');

  select b.id, b.canonical_name,
         public.alias_match_pattern(array_remove(
           array[v_project.brand_name, b.canonical_name, b.primary_website]
           || coalesce(b.aliases, '{}') || coalesce(v_project.brand_terms, '{}')
           || coalesce(v_project.brand_domains, '{}') || coalesce(b.additional_websites, '{}'), null))
  into v_tracked_id, v_tracked_name, v_pattern
  from public.brand_registry b
  where b.project_id = p_project_id and b.is_tracked_brand and b.is_active limit 1;
  if v_tracked_id is null or v_pattern is null then raise exception 'tracked brand not configured'; end if;

  if exists (select 1 from public.tracking_runs where project_id = p_project_id and data_source = 'profound_import' and import_batch = p_batch) then
    raise exception 'batch % has already been imported', p_batch;
  end if;

  create temp table _pi_prompts on commit drop as
  select pr.id, pr.topic, lower(btrim(pr.prompt)) as k,
         row_number() over (partition by lower(btrim(pr.prompt)) order by pr.prompt_number, pr.id) as rk,
         count(*) over (partition by lower(btrim(pr.prompt))) as n
  from public.prompts pr where pr.project_id = p_project_id;

  create temp table _pi_rows on commit drop as
  select gen_random_uuid() as rid, s.id as sid, s.run_date, s.engine, s.response_status, s.response_text, s.cited_urls, s.meta,
         s.prompt, s.profound_mentioned as flagged, p.id as prompt_id, p.topic
  from public.profound_import_rows s
  join _pi_prompts p on p.k = lower(btrim(s.prompt)) and p.rk = least(s.row_seq, p.n)
  where s.project_id = p_project_id and s.batch = p_batch;

  select count(*) into v_unmatched from public.profound_import_rows s
  where s.project_id = p_project_id and s.batch = p_batch and not exists (select 1 from _pi_rows r where r.sid = s.id);

  select coalesce(jsonb_agg(distinct jsonb_build_object('date', d.run_date, 'engine', d.engine)), '[]'::jsonb) into v_skipped
  from (select distinct r.run_date, r.engine from _pi_rows r
        where exists (select 1 from public.tracking_runs t
                      where t.project_id = p_project_id and t.provider = r.engine and t.tracking_location = v_loc
                        and t.run_kind = 'topic' and t.status = 'completed' and t.published_at is not null and t.superseded_at is null
                        and (t.published_at at time zone 'Asia/Kuala_Lumpur')::date = r.run_date)) d;
  if not p_replace_existing then
    delete from _pi_rows r
    where exists (select 1 from public.tracking_runs t
                  where t.project_id = p_project_id and t.provider = r.engine and t.tracking_location = v_loc
                    and t.run_kind = 'topic' and t.status = 'completed' and t.published_at is not null and t.superseded_at is null
                    and (t.published_at at time zone 'Asia/Kuala_Lumpur')::date = r.run_date);
  else
    v_skipped := '[]'::jsonb;
  end if;
  select min(run_date), max(run_date) into v_dmin, v_dmax from _pi_rows;
  if v_dmin is null then
    return jsonb_build_object('status', 'nothing_to_import', 'unmatched_rows', v_unmatched, 'skipped_engine_days', v_skipped);
  end if;

  -- Is the tracked brand present in the response?
  alter table _pi_rows add column present boolean;
  update _pi_rows r set present = case
    when r.response_status <> 'completed' then false
    when p_presence_source = 'profound' then coalesce(r.flagged, false)
    else r.response_text ~* v_pattern end;

  create temp table _pi_runs (id uuid, provider text, topic text, run_date date) on commit drop;
  with ins as (
    insert into public.tracking_runs (
      project_id, provider, status, total_prompts, completed_prompts, failed_prompts, started_at, completed_at,
      tracking_location, topic, run_kind, data_source, import_batch)
    select p_project_id, g.engine, 'completed', g.n, g.ok, g.n - g.ok,
           (g.run_date::text || ' 12:00:00+08')::timestamptz, (g.run_date::text || ' 12:00:00+08')::timestamptz,
           v_loc, g.topic, 'topic', 'profound_import', p_batch
    from (select run_date, engine, topic, count(*)::integer as n, (count(*) filter (where response_status = 'completed'))::integer as ok
          from _pi_rows group by run_date, engine, topic) g
    returning id, provider, topic, (started_at at time zone 'Asia/Kuala_Lumpur')::date as run_date
  ) insert into _pi_runs select * from ins;
  get diagnostics v_runs = row_count;
  alter table _pi_rows add column run_id uuid;
  update _pi_rows r set run_id = u.id from _pi_runs u where u.provider = r.engine and u.topic = r.topic and u.run_date = r.run_date;

  insert into public.ai_responses (
    id, project_id, prompt_id, llm_provider, captured_at, prompt_snapshot, raw_response, response_text, response_status,
    error_message, run_id, brand_name_snapshot, tracking_location, data_source)
  select r.rid, p_project_id, r.prompt_id, r.engine, (r.run_date::text || ' 12:00:00+08')::timestamptz, r.prompt,
         jsonb_build_object(
           'object', 'response', 'status', r.response_status,
           'output', jsonb_build_array(jsonb_build_object(
             'type', 'message', 'role', 'assistant', 'status', 'completed',
             'content', jsonb_build_array(jsonb_build_object(
               'type', 'output_text', 'text', r.response_text,
               'annotations', coalesce((select jsonb_agg(jsonb_build_object('type', 'url_citation', 'url', u.url, 'title', null) order by u.ord)
                                        from unnest(r.cited_urls) with ordinality u(url, ord)), '[]'::jsonb))))),
           'profound', r.meta, 'source', 'profound_import'),
         r.response_text, r.response_status,
         case when r.response_status = 'failed' then 'Empty response in Profound export' end,
         r.run_id, v_project.brand_name, v_loc, 'profound_import'
  from _pi_rows r;
  get diagnostics v_resp = row_count;

  insert into public.response_brand_evidence (
    project_id, response_id, brand_id, topic, match_source, matched_value, evidence_text, first_position, occurrence_count, confidence)
  select p_project_id, r.rid, v_tracked_id, r.topic, 'response_text', v_tracked_name,
         case when r.response_text ~* v_pattern
              then substr(r.response_text, greatest(1, regexp_instr(r.response_text, v_pattern, 1, 1, 0, 'i') - 80), 260)
              else left(r.response_text, 260) end,
         case when r.response_text ~* v_pattern then regexp_instr(r.response_text, v_pattern, 1, 1, 0, 'i') - 1 end,
         greatest(regexp_count(r.response_text, v_pattern, 1, 'i'), 1),
         case when p_presence_source = 'profound' then 'verified' else 'deterministic' end
  from _pi_rows r where r.present;
  get diagnostics v_evidence = row_count;

  insert into public.visibility_daily (
    project_id, metric_date, tracking_location, topic, llm_provider, run_id, visibility_score,
    presence_count, response_count, rank_population_status, metric_version, citation_count)
  select p_project_id, u.run_date, v_loc, u.topic, u.provider, u.id,
         case when c.resp > 0 then round(c.pres::numeric / c.resp * 100, 1) end,
         case when c.resp > 0 then c.pres end, case when c.resp > 0 then c.resp end, 'unverified', 'v2', 0
  from _pi_runs u
  cross join lateral (
    select (count(*) filter (where r.response_status = 'completed'))::integer as resp,
           (count(*) filter (where r.present))::integer as pres
    from _pi_rows r where r.run_id = u.id) c
  on conflict (project_id, metric_date, topic, llm_provider, tracking_location) do update set
    run_id = excluded.run_id, visibility_score = excluded.visibility_score, presence_count = excluded.presence_count,
    response_count = excluded.response_count, share_of_voice_score = null, share_of_voice_rank = null,
    average_position = null, average_position_rank = null, visibility_rank = null, metric_version = 'v2';

  -- Publishing supersedes a platform run of the same engine and day (only when p_replace_existing kept those units).
  update public.tracking_runs t set published_at = t.completed_at where t.id in (select id from _pi_runs);

  v_engine := public.recompute_competitor_metrics(p_project_id, v_dmin, v_dmax);

  insert into public.citations (
    project_id, metric_date, topic, llm_provider, url, page_name, brand_name, is_brand_related, frequency, tracking_location)
  select p_project_id, r.run_date, r.topic, r.engine, c.url,
         replace(replace(regexp_replace(c.host, '[.][^.]+$', ''), '-', ' '), '_', ' '),
         case when c.related then v_project.brand_name else replace(replace(regexp_replace(c.host, '[.][^.]+$', ''), '-', ' '), '_', ' ') end,
         c.related, count(distinct r.rid)::integer, v_loc
  from _pi_rows r
  cross join lateral unnest(r.cited_urls) cu(url)
  cross join lateral (
    select cu.url as url,
           regexp_replace(lower(split_part(split_part(regexp_replace(cu.url, '^https?://', '', 'i'), '/', 1), ':', 1)), '^www[.]', '') as host
  ) h
  cross join lateral (
    select h.url as url, h.host as host,
           exists (select 1 from unnest(coalesce(v_project.brand_domains, '{}')) bd(dom)
                   where regexp_replace(lower(bd.dom), '^www[.]', '') <> ''
                     and (h.host = regexp_replace(lower(bd.dom), '^www[.]', '') or h.host like '%.' || regexp_replace(lower(bd.dom), '^www[.]', ''))) as related
  ) c
  where r.response_status = 'completed' and cu.url ~* '^https?://'
  group by r.run_date, r.topic, r.engine, c.url, c.host, c.related
  on conflict (project_id, metric_date, topic, llm_provider, url, tracking_location) do update set
    frequency = excluded.frequency, page_name = excluded.page_name, brand_name = excluded.brand_name, is_brand_related = excluded.is_brand_related;
  get diagnostics v_citations = row_count;

  return jsonb_build_object(
    'status', 'completed', 'batch', p_batch, 'location', v_loc, 'presence_source', p_presence_source,
    'date_from', v_dmin, 'date_to', v_dmax, 'unmatched_rows', v_unmatched, 'skipped_engine_days', v_skipped,
    'runs', v_runs, 'responses', v_resp, 'tracked_evidence_rows', v_evidence, 'citation_rows', v_citations, 'engine', v_engine);
end;
$$;

revoke all on function public.import_profound_batch(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.import_profound_batch(uuid, text, boolean, text) to service_role;
