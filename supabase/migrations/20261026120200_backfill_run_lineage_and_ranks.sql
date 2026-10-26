-- Issues 02/05/10: backfill verifiable lineage and rank populations.
--
-- A topic-scoped run that predates run lineage (tracking_runs.topic is null) is
-- recovered only when its stage journal proves the topic, every stage completed,
-- its stored responses match the prompt counts, its competitor observation set
-- matches the registered eligible competitors, and the stored tracked score equals
-- the score recomputed from raw evidence. Anything else stays unverified.

create or replace function public.backfill_verified_topic_runs()
returns table(run_id uuid, topic text, metric_date date, outcome text)
language plpgsql security definer set search_path = public as $$
declare
  c record;
  v_expected integer;
  v_obs integer;
begin
  for c in
    select * from (
      select tr.id, tr.project_id, tr.provider, tr.tracking_location, tr.completed_at,
             tr.total_prompts, tr.completed_prompts,
             st.metadata->>'topic' as stage_topic,
             (tr.started_at at time zone 'Asia/Kuala_Lumpur')::date as d,
             row_number() over (
               partition by tr.project_id, (tr.started_at at time zone 'Asia/Kuala_Lumpur')::date,
                            st.metadata->>'topic', tr.provider, tr.tracking_location
               order by tr.completed_at desc nulls last, tr.id desc) as rn
      from public.tracking_runs tr
      join public.tracking_run_stages st on st.run_id = tr.id and st.stage_key = 'topic_cleanup'
      join public.projects p on p.id = tr.project_id
      where tr.topic is null and tr.status = 'completed' and tr.completed_at is not null
        and tr.published_at is null and tr.total_prompts = tr.completed_prompts
        and st.status = 'completed' and st.metadata->>'topic_scoped' = 'true'
        and st.metadata->>'topic' = any(p.topics)
    ) x where x.rn = 1
    order by x.d, x.completed_at
  loop
    run_id := c.id; topic := c.stage_topic; metric_date := c.d;
    begin
      if exists (select 1 from public.tracking_run_stages s where s.run_id = c.id and s.status <> 'completed') then
        raise exception 'stage journal incomplete';
      end if;
      if (select count(*) from public.ai_responses ar where ar.run_id = c.id and ar.response_status = 'completed') <> c.completed_prompts
         or (select count(*) from public.ai_responses ar where ar.run_id = c.id) <> c.total_prompts then
        raise exception 'stored responses do not match prompt counts';
      end if;

      select count(*) into v_expected from public.topic_brand_assignments a
      where a.project_id = c.project_id and a.topic = c.stage_topic and a.role = 'competitor' and a.include_in_metrics;
      select count(distinct o.brand_id) into v_obs from public.topic_brand_observations o
      where o.project_id = c.project_id and o.metric_date = c.d and o.topic = c.stage_topic
        and o.llm_provider = c.provider and o.tracking_location = c.tracking_location and o.run_id is null;
      if v_obs <> v_expected or v_obs = 0 then
        raise exception 'competitor observations (%) do not match registered competitors (%)', v_obs, v_expected;
      end if;

      update public.tracking_runs set topic = c.stage_topic, run_kind = 'topic' where id = c.id;
      update public.topic_brand_observations o set run_id = c.id
      where o.project_id = c.project_id and o.metric_date = c.d and o.topic = c.stage_topic
        and o.llm_provider = c.provider and o.tracking_location = c.tracking_location and o.run_id is null;
      update public.visibility_daily v set run_id = c.id
      where v.project_id = c.project_id and v.metric_date = c.d and v.topic = c.stage_topic
        and v.tracking_location = c.tracking_location and v.run_id is null
        and v.llm_provider in ('chatgpt', 'Overall');

      -- Publication runs the guard: score must equal the evidence recomputation, then rank/population are stamped.
      update public.tracking_runs set published_at = c.completed_at where id = c.id;
      outcome := 'published';
      return next;
    exception when others then
      outcome := 'skipped: ' || sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

revoke all on function public.backfill_verified_topic_runs() from public, anon, authenticated;
grant execute on function public.backfill_verified_topic_runs() to service_role;
