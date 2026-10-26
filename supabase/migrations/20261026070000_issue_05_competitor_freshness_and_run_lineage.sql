-- Issue 05: run-linked scoped competitor freshness. Legacy NULL run_id rows are
-- retained as unverifiable history; NOT VALID checks enforce future writes.
create index if not exists topic_brand_observations_run_scope_idx
  on public.topic_brand_observations(project_id,run_id,topic,metric_date,llm_provider,tracking_location,brand_id)
  where run_id is not null;
create index if not exists tracking_runs_published_scope_idx
  on public.tracking_runs(project_id,topic,provider,tracking_location,published_at desc)
  where status='completed' and published_at is not null;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='topic_brand_observations_run_id_required_for_new_rows' and conrelid='public.topic_brand_observations'::regclass) then
  alter table public.topic_brand_observations add constraint topic_brand_observations_run_id_required_for_new_rows check(run_id is not null) not valid;
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='topic_brand_observations_run_id_fkey' and conrelid='public.topic_brand_observations'::regclass) then
  alter table public.topic_brand_observations add constraint topic_brand_observations_run_id_fkey foreign key(run_id) references public.tracking_runs(id) not valid;
 end if;
end $$;
create or replace function public.get_published_competitor_observations(
 p_project_id uuid,p_metric_date date,p_topic text,p_provider text,p_tracking_location text
) returns table(
 published_run_id uuid,published_at timestamptz,run_status text,
 expected_competitor_count integer,observed_competitor_count integer,coverage_status text,
 brand_id uuid,presence_count integer,response_count integer,mention_count integer,citation_count integer,average_position numeric
) language sql stable security definer set search_path=public as $$
 with canonical_run as (
  select tr.id,tr.published_at,tr.status from public.tracking_runs tr
  where tr.project_id=p_project_id and (tr.topic=p_topic or tr.topic is null) and tr.provider=p_provider
   and tr.tracking_location=p_tracking_location and tr.status='completed' and tr.published_at is not null
   and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date=p_metric_date
  order by tr.published_at desc,tr.id desc limit 1
 ), eligible as (
  select tba.brand_id as id from public.topic_brand_assignments tba where tba.project_id=p_project_id
   and tba.topic=p_topic and tba.role='competitor' and tba.include_in_metrics=true
 ), scoped as (
  select o.* from public.topic_brand_observations o join canonical_run cr on cr.id=o.run_id
   join eligible e on e.id=o.brand_id
  where o.project_id=p_project_id and o.metric_date=p_metric_date and o.topic=p_topic
   and o.llm_provider=p_provider and o.tracking_location=p_tracking_location and o.response_count>0
 ), counts as (
  select (select count(*)::integer from eligible) expected,
   (select count(distinct brand_id)::integer from scoped) observed
 )
 select cr.id,cr.published_at,cr.status,counts.expected,counts.observed,
  case when counts.observed=0 then 'missing_observations' when counts.observed<counts.expected then 'partial_coverage' else 'complete' end,
  s.brand_id,s.presence_count,s.response_count,s.mention_count,s.citation_count,s.average_position
 from canonical_run cr cross join counts left join scoped s on true
 union all
 select null::uuid,null::timestamptz,null::text,(select count(*)::integer from eligible),0,
  'missing_published_run',null::uuid,null::integer,null::integer,null::integer,null::integer,null::numeric
 where not exists(select 1 from canonical_run);
$$;
grant execute on function public.get_published_competitor_observations(uuid,date,text,text,text) to authenticated,service_role;
