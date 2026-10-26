-- Issues 01/02/03/06/09/10: one canonical rank, one Overall calculation, one publication gate.
--
-- * run_tracked_presence      tracked-brand numerator/denominator from raw responses + evidence
-- * canonical_scoped_rank     the only rank implementation (competition ranking, unrounded)
-- * finalize_run_metrics      stamps counts/rank/population/lineage on a run's daily rows
-- * tracking_runs guard       supersedes the prior run, finalizes metrics, blocks inconsistent publication
-- * publish_overall_metrics   Overall = pooled responses of the latest published topic runs

create or replace function public.run_tracked_presence(p_run_id uuid, p_topic text)
returns table(presence_count integer, response_count integer)
language sql stable security definer set search_path = public as $$
  with resp as (
    select ar.id
    from public.ai_responses ar
    left join public.prompts pr on pr.id = ar.prompt_id
    where ar.run_id = p_run_id
      and ar.response_status = 'completed'
      and (p_topic = 'Overall' or pr.topic = p_topic)
  )
  select
    (select count(distinct e.response_id)::integer
       from public.response_brand_evidence e
       join public.brand_registry b on b.id = e.brand_id and b.is_tracked_brand
       join resp r on r.id = e.response_id),
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

comment on function public.canonical_scoped_rank(uuid, uuid, text, date, text, text, integer, integer) is
  'Single rank implementation. Rank 1 is best; ties share a rank (competition ranking); compares exact presence/response fractions, never rounded scores. Population = tracked brand + competitors with response_count > 0 in the same run/topic/date/provider/location.';

create or replace function public.finalize_run_metrics(p_run_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_run public.tracking_runs%rowtype;
  r record;
  v_pres integer;
  v_resp integer;
  v_rank record;
  v_updated integer := 0;
begin
  select * into v_run from public.tracking_runs where id = p_run_id;
  if not found then return 0; end if;

  for r in
    select id, topic, metric_date, visibility_score
    from public.visibility_daily where run_id = p_run_id
  loop
    select t.presence_count, t.response_count into v_pres, v_resp
    from public.run_tracked_presence(p_run_id, r.topic) t;

    if coalesce(v_resp, 0) > 0
       and r.visibility_score is not null
       and abs(round(v_pres::numeric / v_resp * 100, 1) - r.visibility_score) > 0.05 then
      raise exception 'PUBLICATION_BLOCKED: stored visibility % for % on % does not match % of % valid responses (run %)',
        r.visibility_score, r.topic, r.metric_date, v_pres, v_resp, p_run_id;
    end if;

    select * into v_rank from public.canonical_scoped_rank(
      v_run.project_id, p_run_id, r.topic, r.metric_date, v_run.provider, v_run.tracking_location, v_pres, v_resp);

    update public.visibility_daily set
      presence_count = case when v_resp > 0 then v_pres end,
      response_count = case when v_resp > 0 then v_resp end,
      visibility_rank = v_rank.visibility_rank,
      rank_population_count = v_rank.rank_population_count,
      rank_population_status = v_rank.rank_population_status,
      source_run_ids = array[p_run_id],
      metric_version = 'v2'
    where id = r.id;
    v_updated := v_updated + 1;
  end loop;
  return v_updated;
end;
$$;

revoke all on function public.run_tracked_presence(uuid, text) from public, anon, authenticated;
revoke all on function public.canonical_scoped_rank(uuid, uuid, text, date, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.finalize_run_metrics(uuid) from public, anon, authenticated;
grant execute on function public.run_tracked_presence(uuid, text) to service_role;
grant execute on function public.canonical_scoped_rank(uuid, uuid, text, date, text, text, integer, integer) to service_role;
grant execute on function public.finalize_run_metrics(uuid) to service_role;

-- Publication guard: default run_kind on insert; on publication supersede the
-- prior published run of the same scope/day and finalize canonical metrics.
create or replace function public.tracking_runs_publication_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prior uuid;
begin
  if tg_op = 'INSERT' then
    if new.run_kind is null then
      new.run_kind := case when new.topic is null then 'full' else 'topic' end;
    end if;
    return new;
  end if;

  if new.topic is not null and new.run_kind is distinct from 'topic' and new.run_kind is distinct from 'overall_aggregate' then
    new.run_kind := 'topic';
  end if;

  if new.published_at is not null and old.published_at is null and new.status = 'completed' then
    with prior as (
      update public.tracking_runs o set superseded_at = now()
      where o.id <> new.id and o.project_id = new.project_id and o.provider = new.provider
        and o.tracking_location = new.tracking_location
        and coalesce(o.topic, '') = coalesce(new.topic, '')
        and coalesce(o.run_kind, '') = coalesce(new.run_kind, '')
        and o.status = 'completed' and o.published_at is not null and o.superseded_at is null
        and (o.published_at at time zone 'Asia/Kuala_Lumpur')::date = (new.published_at at time zone 'Asia/Kuala_Lumpur')::date
      returning o.id
    )
    select id into v_prior from prior limit 1;
    new.supersedes_run_id := coalesce(new.supersedes_run_id, v_prior);
    new.superseded_at := null;
    if new.run_kind <> 'overall_aggregate' then
      perform public.finalize_run_metrics(new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tracking_runs_publication_guard_ins on public.tracking_runs;
create trigger tracking_runs_publication_guard_ins
  before insert on public.tracking_runs
  for each row execute function public.tracking_runs_publication_guard();
drop trigger if exists tracking_runs_publication_guard_upd on public.tracking_runs;
create trigger tracking_runs_publication_guard_upd
  before update on public.tracking_runs
  for each row execute function public.tracking_runs_publication_guard();

-- Overall = pooled responses of the latest published topic run of every project topic.
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
  v_comp_mentions numeric;
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

  -- Incomplete topic coverage: never publish a partial pooled aggregate.
  if coalesce(cardinality(v_members), 0) <> cardinality(v_topics) then return null; end if;

  select sum(t.presence_count), sum(t.response_count) into v_pres, v_resp
  from unnest(v_members, v_member_topics) m(run_id, topic)
  cross join lateral public.run_tracked_presence(m.run_id, m.topic) t;
  if coalesce(v_resp, 0) = 0 then return null; end if;

  -- Retire the previous aggregate for this scope/day, then record the new one.
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
    (select id from public.tracking_runs x where x.project_id = p_project_id and x.provider = p_provider
       and x.tracking_location = p_location and x.run_kind = 'overall_aggregate'
       and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
     order by x.superseded_at desc nulls last, x.published_at desc limit 1)
  from public.tracking_runs where id = any(v_members)
  returning id into v_agg;

  -- Pooled competitor observations: presence and responses summed over the topics each competitor was observed in.
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
  where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
    and v.llm_provider = 'Overall' and v.run_id = any(v_members) and v.topic = any(v_member_topics);

  -- Share of voice: pooled from the member topic rows (mention-weighted); topics at 100% cannot be decomposed and are skipped.
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
    ) comp
    where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
      and v.llm_provider = 'Overall' and v.share_of_voice_score is not null and v.share_of_voice_score < 100
  ) t;

  select coalesce(sum(o.mention_count), 0) into v_comp_mentions
  from public.topic_brand_observations o
  where o.run_id = v_agg and o.topic = 'Overall' and o.response_count > 0;
  v_sov_rank := case when v_sov_total > 0
    then 1 + (select count(*) from public.topic_brand_observations o
              where o.run_id = v_agg and o.topic = 'Overall' and o.response_count > 0 and o.mention_count > v_sov_tracked)::integer end;

  select sum(v.average_position * t.presence_count) / nullif(sum(t.presence_count) filter (where v.average_position is not null), 0)
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

revoke all on function public.publish_overall_metrics(uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.publish_overall_metrics(uuid, date, text, text) to service_role;

-- The batch-completion trigger now uses the canonical pooled calculation.
create or replace function public.rebuild_overall_metrics_for_tracking_batch(p_batch_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid;
  v_location text;
  v_metric_date date;
begin
  select b.project_id into v_project_id
  from public.tracking_batches b where b.id = p_batch_id and b.status = 'completed';
  if v_project_id is null then return; end if;

  select tr.tracking_location, (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date
  into v_location, v_metric_date
  from public.tracking_batch_topics bt
  join public.tracking_runs tr on tr.id = bt.tracking_run_id
  where bt.batch_id = p_batch_id and tr.status = 'completed' and tr.published_at is not null
  order by tr.published_at desc limit 1;
  if v_metric_date is null then return; end if;

  perform public.publish_overall_metrics(v_project_id, v_metric_date, v_location, 'chatgpt');
end;
$$;
