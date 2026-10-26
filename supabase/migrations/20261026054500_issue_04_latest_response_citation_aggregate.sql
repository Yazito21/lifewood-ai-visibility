-- Reconcile reruns by selecting the latest completed response per prompt and scope first.
-- This prevents old citation URLs from surviving when a newer response omitted them.
create or replace function public.get_scoped_citation_occurrence_counts(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_topic text default null,
  p_engines text[] default '{}',
  p_tracking_location text default null
)
returns table(entity_id uuid, citation_occurrences bigint, unique_pages bigint, unique_domains bigint)
language sql stable
set search_path to 'public'
as $function$
  with latest_responses as (
    select distinct on (
      r.project_id, (timezone('Asia/Kuala_Lumpur', r.captured_at))::date,
      p.topic, r.llm_provider, r.tracking_location, r.prompt_id
    )
      r.id as response_id,
      r.project_id,
      (timezone('Asia/Kuala_Lumpur', r.captured_at))::date as metric_date,
      p.topic,
      r.llm_provider as provider,
      r.tracking_location,
      r.prompt_id
    from public.ai_responses r
    join public.prompts p on p.id = r.prompt_id and p.project_id = r.project_id
    where r.project_id = p_project_id
      and r.response_status = 'completed'
      and (timezone('Asia/Kuala_Lumpur', r.captured_at))::date between p_start_date and p_end_date
      and r.tracking_location = coalesce(p_tracking_location, (select pr.tracking_market from public.projects pr where pr.id=p_project_id), 'LEGACY')
      and (p_topic is null or p.topic = p_topic)
      and (coalesce(array_length(p_engines,1),0)=0 or r.llm_provider = any(p_engines))
    order by r.project_id, (timezone('Asia/Kuala_Lumpur', r.captured_at))::date,
      p.topic, r.llm_provider, r.tracking_location, r.prompt_id, r.captured_at desc, r.id desc
  )
  select c.entity_id, count(*)::bigint,
         count(distinct c.canonical_url)::bigint,
         count(distinct c.canonical_domain)::bigint
  from public.citation_occurrences c
  join latest_responses lr on lr.response_id = c.response_id
    and lr.project_id = c.project_id and lr.metric_date = c.metric_date
    and lr.topic = c.topic and lr.provider = c.provider
    and lr.tracking_location = c.tracking_location
  group by c.entity_id;
$function$;

comment on function public.get_scoped_citation_occurrence_counts(uuid,date,date,text,text[],text) is
  'Aggregates normalized citation evidence only from the latest completed response per prompt/date/topic/provider/location. Unit: one canonical URL per entity per response; no stale URL survives when a newer response omitted it.';
