create or replace function public.get_direct_competitor_metrics_for_period(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_tracking_location text default null
)
returns table(topic text, metric_date date, visibility_rank integer, competitor_count bigint)
language sql stable set search_path = public
as $function$
  with chosen_location as (
    select coalesce(p_tracking_location, p.tracking_market, 'LEGACY') as location
    from public.projects p where p.id = p_project_id
  ),
  latest as (
    select vd.topic, max(vd.metric_date) as metric_date
    from public.visibility_daily vd cross join chosen_location cl
    where vd.project_id = p_project_id and vd.llm_provider = 'Overall'
      and vd.tracking_location = cl.location
      and vd.metric_date between p_start_date and p_end_date
    group by vd.topic
  ),
  brand_scores as (
    select vd.project_id, vd.topic, vd.metric_date, vd.tracking_location,
      coalesce(vd.visibility_score, 0)::numeric as brand_score
    from public.visibility_daily vd join latest l on l.topic=vd.topic and l.metric_date=vd.metric_date
    cross join chosen_location cl
    where vd.project_id=p_project_id and vd.llm_provider='Overall' and vd.tracking_location=cl.location
  ),
  eligible_observations as (
    select dc.topic, dc.normalized_domain, o.metric_date, o.tracking_location,
      o.llm_provider, o.presence_count, o.response_count
    from public.direct_competitors dc
    join public.direct_competitor_observations o on o.competitor_id=dc.id and o.project_id=dc.project_id
    cross join chosen_location cl
    join latest l on l.topic=dc.topic and l.metric_date=o.metric_date
    where dc.project_id=p_project_id and o.tracking_location=cl.location
      and o.llm_provider='chatgpt' and o.metric_date between p_start_date and p_end_date
      and o.response_count > 0
  ),
  scored as (
    select topic, metric_date, tracking_location, normalized_domain,
      max(100.0 * presence_count / nullif(response_count,0))::numeric as competitor_score
    from eligible_observations
    group by topic, metric_date, tracking_location, normalized_domain
  ),
  ranked as (
    select bs.topic, bs.metric_date,
      count(distinct s.normalized_domain)::bigint as eligible_competitors,
      count(distinct s.normalized_domain) filter(where s.competitor_score > bs.brand_score)::bigint as competitors_above
    from brand_scores bs left join scored s
      on s.topic=bs.topic and s.metric_date=bs.metric_date and s.tracking_location=bs.tracking_location
    group by bs.topic,bs.metric_date,bs.tracking_location,bs.brand_score
  )
  select r.topic,r.metric_date,
    case when r.eligible_competitors=0 then null else (1+r.competitors_above)::integer end as visibility_rank,
    (r.eligible_competitors+1)::bigint as competitor_count
  from ranked r order by r.topic;
$function$;

comment on function public.get_direct_competitor_metrics_for_period(uuid,date,date,text) is
  'Ranks against competitors with valid scoped observations (response_count > 0), including valid zero-presence records. Strictly-greater comparison uses competition ranking; equal scores share a rank.';
