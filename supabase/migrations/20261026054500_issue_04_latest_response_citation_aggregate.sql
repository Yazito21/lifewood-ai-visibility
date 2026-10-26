-- For repeated same-day runs, count the latest completed response for each prompt/scope.
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
  with scoped as (
    select c.entity_id, c.canonical_url, c.canonical_domain, c.metric_date, c.topic,
           c.provider, c.tracking_location, r.prompt_id, r.captured_at,
           row_number() over (
             partition by c.project_id, c.metric_date, c.topic, c.provider,
                          c.tracking_location, c.entity_id, r.prompt_id, c.canonical_url
             order by r.captured_at desc, c.response_id desc
           ) as response_version
    from public.citation_occurrences c
    join public.ai_responses r on r.id = c.response_id and r.project_id = c.project_id
    where c.project_id = p_project_id
      and c.metric_date between p_start_date and p_end_date
      and c.tracking_location = coalesce(p_tracking_location, (select p.tracking_market from public.projects p where p.id=p_project_id), 'LEGACY')
      and (p_topic is null or c.topic = p_topic)
      and (coalesce(array_length(p_engines,1),0)=0 or c.provider = any(p_engines))
      and r.response_status = 'completed'
  )
  select s.entity_id, count(*)::bigint,
         count(distinct s.canonical_url)::bigint,
         count(distinct s.canonical_domain)::bigint
  from scoped s where s.response_version = 1 group by s.entity_id;
$function$;

comment on function public.get_scoped_citation_occurrence_counts(uuid,date,date,text,text[],text) is
  'Aggregates normalized citations per prompt scope, retaining only latest captured response version for repeated daily runs. Unit: one canonical URL per entity per prompt response.';
