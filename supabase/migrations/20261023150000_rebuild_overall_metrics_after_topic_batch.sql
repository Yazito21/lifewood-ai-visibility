-- Rebuild the Overall daily metrics after a sequential topic batch completes.
-- Topic runs persist their own daily rows. The batch completion transition is the
-- synchronization point at which all selected topic responses are available.
create or replace function public.rebuild_overall_metrics_for_tracking_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_location text;
  v_metric_date date;
  v_brand_terms text[];
  v_brand_response_count integer;
  v_total_responses integer;
  v_brand_mentions integer;
  v_competitor_mentions integer;
  v_visibility_rank integer;
  v_share_of_voice numeric;
  v_average_position numeric;
  v_citation_count integer;
begin
  select b.project_id into v_project_id
  from public.tracking_batches b
  where b.id = p_batch_id and b.status = 'completed';

  if v_project_id is null then
    return;
  end if;

  select coalesce(p.brand_terms, array[]::text[]) || array[coalesce(p.brand_name, '')]
    into v_brand_terms
  from public.projects p where p.id = v_project_id;

  -- A batch is tied to one location in the current tracking workflow.
  select coalesce(tr.tracking_location, 'MY'), (tr.completed_at at time zone 'Asia/Kuala_Lumpur')::date
    into v_location, v_metric_date
  from public.tracking_batch_topics bt
  join public.tracking_runs tr on tr.id = bt.tracking_run_id
  where bt.batch_id = p_batch_id and tr.status = 'completed'
  order by tr.completed_at desc limit 1;

  if v_metric_date is null then
    return;
  end if;

  with responses as (
    select ar.id, ar.response_text, ar.response_analysis
    from public.tracking_batch_topics bt
    join public.tracking_runs tr on tr.id = bt.tracking_run_id and tr.status = 'completed'
    join public.ai_responses ar on ar.run_id = tr.id
    where bt.batch_id = p_batch_id
      and ar.project_id = v_project_id
      and coalesce(ar.tracking_location, 'MY') = v_location
      and ar.response_status = 'completed'
      and coalesce(ar.response_analysis->>'status', 'completed') = 'completed'
  ),
  brand_counts as (
    select count(*) filter (where exists (
      select 1 from unnest(v_brand_terms) term
      where length(trim(term)) > 1
        and position(lower(trim(term)) in lower(coalesce(r.response_text, ''))) > 0
    ))::integer as brand_responses,
    count(*)::integer as total_responses
    from responses r
  ),
  competitors as (
    select lower(trim(coalesce(e->>'name',''))) as entity_name,
           array(select lower(trim(a)) from jsonb_array_elements_text(
             case when jsonb_typeof(e->'aliases') = 'array' then e->'aliases' else '[]'::jsonb end
           ) a) as aliases
    from responses r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.response_analysis->'entities') = 'array'
           then r.response_analysis->'entities' else '[]'::jsonb end
    ) e
    where length(trim(coalesce(e->>'name',''))) > 1
      and not exists (
        select 1 from unnest(v_brand_terms) term
        where length(trim(term)) > 1
          and lower(trim(term)) = lower(trim(coalesce(e->>'name','')))
      )
    group by lower(trim(coalesce(e->>'name',''))), e->'aliases'
  ),
  competitor_counts as (
    select c.entity_name,
      count(*) filter (where
        position(c.entity_name in lower(coalesce(r.response_text,''))) > 0
        or exists (select 1 from unnest(c.aliases) a where length(a)>1 and position(a in lower(coalesce(r.response_text,'')))>0)
      )::integer as response_count
    from competitors c cross join responses r
    group by c.entity_name
  )
  select bc.brand_responses, bc.total_responses,
         coalesce((select sum(cc.response_count) from competitor_counts cc),0)::integer
    into v_brand_response_count, v_total_responses, v_competitor_mentions
  from brand_counts bc;

  select count(*) filter (where exists (
    select 1 from unnest(v_brand_terms) term
    where length(trim(term)) > 1 and position(lower(trim(term)) in lower(coalesce(ar.response_text,''))) > 0
  ))::integer
  into v_brand_mentions
  from public.tracking_batch_topics bt
  join public.tracking_runs tr on tr.id = bt.tracking_run_id and tr.status = 'completed'
  join public.ai_responses ar on ar.run_id = tr.id
  where bt.batch_id = p_batch_id and ar.project_id = v_project_id
    and coalesce(ar.tracking_location,'MY') = v_location and ar.response_status = 'completed';

  with responses as (
    select ar.response_text, ar.response_analysis
    from public.tracking_batch_topics bt
    join public.tracking_runs tr on tr.id = bt.tracking_run_id and tr.status = 'completed'
    join public.ai_responses ar on ar.run_id = tr.id
    where bt.batch_id = p_batch_id and ar.project_id = v_project_id
      and coalesce(ar.tracking_location,'MY') = v_location and ar.response_status = 'completed'
      and coalesce(ar.response_analysis->>'status','completed') = 'completed'
  ), competitor_presence as (
    select lower(trim(e->>'name')) entity_name, count(*)::integer present_count
    from responses r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.response_analysis->'entities')='array'
        then r.response_analysis->'entities' else '[]'::jsonb end
    ) e
    where length(trim(coalesce(e->>'name',''))) > 1
      and not exists (select 1 from unnest(v_brand_terms) t where lower(trim(t))=lower(trim(e->>'name')))
      and position(lower(trim(e->>'name')) in lower(coalesce(r.response_text,''))) > 0
    group by lower(trim(e->>'name'))
  )
  select 1 + count(*) filter (where present_count > coalesce(v_brand_response_count,0))
    into v_visibility_rank from competitor_presence;

  v_share_of_voice := case when coalesce(v_brand_mentions,0)+coalesce(v_competitor_mentions,0)>0
    then round(v_brand_mentions::numeric/(v_brand_mentions+v_competitor_mentions)*100,1) else 0 end;

  select count(*)::integer into v_citation_count
  from public.third_party_mentions m
  where m.project_id=v_project_id and m.metric_date=v_metric_date
    and m.tracking_location=v_location
    and m.topic in (select bt.topic from public.tracking_batch_topics bt where bt.batch_id=p_batch_id);

  insert into public.visibility_daily (
    project_id, metric_date, tracking_location, topic, llm_provider,
    visibility_score, visibility_rank, share_of_voice_score, share_of_voice_rank,
    average_position, average_position_rank, citation_count
  ) values (
    v_project_id, v_metric_date, v_location, 'Overall', 'Overall',
    case when coalesce(v_total_responses,0)>0 then round(v_brand_response_count::numeric/v_total_responses*100,1) else 0 end,
    v_visibility_rank, v_share_of_voice, v_visibility_rank, v_average_position, null, v_citation_count
  )
  on conflict (project_id, metric_date, topic, llm_provider, tracking_location)
  do update set visibility_score=excluded.visibility_score,
    visibility_rank=excluded.visibility_rank,
    share_of_voice_score=excluded.share_of_voice_score,
    share_of_voice_rank=excluded.share_of_voice_rank,
    average_position=excluded.average_position,
    average_position_rank=excluded.average_position_rank,
    citation_count=excluded.citation_count;

  insert into public.visibility_daily (
    project_id, metric_date, tracking_location, topic, llm_provider,
    visibility_score, visibility_rank, share_of_voice_score, share_of_voice_rank,
    average_position, average_position_rank, citation_count
  )
  select v_project_id, v_metric_date, v_location, 'Overall', 'chatgpt',
    visibility_score, visibility_rank, share_of_voice_score, share_of_voice_rank,
    average_position, average_position_rank, citation_count
  from public.visibility_daily
  where project_id=v_project_id and metric_date=v_metric_date
    and tracking_location=v_location and topic='Overall' and llm_provider='Overall'
  on conflict (project_id, metric_date, topic, llm_provider, tracking_location)
  do update set visibility_score=excluded.visibility_score,
    visibility_rank=excluded.visibility_rank,
    share_of_voice_score=excluded.share_of_voice_score,
    share_of_voice_rank=excluded.share_of_voice_rank,
    average_position=excluded.average_position,
    average_position_rank=excluded.average_position_rank,
    citation_count=excluded.citation_count;
end;
$$;

create or replace function public.trigger_rebuild_overall_after_batch_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    perform public.rebuild_overall_metrics_for_tracking_batch(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists tracking_batch_rebuild_overall on public.tracking_batches;
create trigger tracking_batch_rebuild_overall
after update of status on public.tracking_batches
for each row execute function public.trigger_rebuild_overall_after_batch_completion();

revoke all on function public.rebuild_overall_metrics_for_tracking_batch(uuid) from public, anon, authenticated;
grant execute on function public.rebuild_overall_metrics_for_tracking_batch(uuid) to service_role;
