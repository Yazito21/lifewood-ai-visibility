-- Issue 04: retain citation evidence at response/entity grain without replacing raw responses.
create table if not exists public.citation_occurrences (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  response_id uuid not null references public.ai_responses(id) on delete cascade,
  entity_id uuid not null references public.brand_registry(id) on delete cascade,
  topic text not null,
  metric_date date not null,
  provider text not null,
  tracking_location text not null,
  run_id uuid,
  citation_url text not null,
  canonical_url text not null,
  canonical_domain text not null,
  citation_index integer not null default 1 check (citation_index > 0),
  created_at timestamptz not null default now(),
  constraint citation_occurrences_response_entity_url_key unique (response_id, entity_id, canonical_url)
);

create index if not exists citation_occurrences_scoped_aggregate_idx
  on public.citation_occurrences (project_id, metric_date, topic, provider, tracking_location, entity_id)
  include (response_id, canonical_url, canonical_domain, run_id);
create index if not exists citation_occurrences_response_lookup_idx
  on public.citation_occurrences (response_id, entity_id);

comment on table public.citation_occurrences is
  'One canonical cited URL per valid response and entity. The same page cited in separate responses counts again; repeated instances of the same canonical URL within one response count once.';

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
  select c.entity_id,
         count(*)::bigint,
         count(distinct c.canonical_url)::bigint,
         count(distinct c.canonical_domain)::bigint
  from public.citation_occurrences c
  where c.project_id = p_project_id
    and c.metric_date between p_start_date and p_end_date
    and c.tracking_location = coalesce(p_tracking_location, (select p.tracking_market from public.projects p where p.id=p_project_id), 'LEGACY')
    and (p_topic is null or c.topic = p_topic)
    and (coalesce(array_length(p_engines,1),0)=0 or c.provider = any(p_engines))
  group by c.entity_id;
$function$;

comment on function public.get_scoped_citation_occurrence_counts(uuid,date,date,text,text[],text) is
  'Aggregates normalized citation evidence by entity and exact project/date/topic/provider/location scope. Repeated canonical URL in separate responses counts as separate occurrences.';
