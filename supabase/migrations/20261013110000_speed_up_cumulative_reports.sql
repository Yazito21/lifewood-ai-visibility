-- Faster cumulative reporting and complete dashboard competitor denominators.
create index if not exists citations_project_date_topic_engine_idx
  on public.citations (project_id, metric_date, topic, llm_provider);
create index if not exists competitors_project_date_topic_engine_idx
  on public.competitors (project_id, metric_date, topic, llm_provider);

create or replace function public.get_cumulative_citations(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_topic text default null,
  p_engines text[] default '{}'::text[],
  p_brand_related_only boolean default false
)
returns table (
  url text,
  page_name text,
  brand_name text,
  frequency bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.url,
         max(c.page_name) as page_name,
         max(c.brand_name) as brand_name,
         sum(coalesce(c.frequency, 1))::bigint as frequency
  from public.citations c
  where c.project_id = p_project_id
    and c.metric_date >= p_start_date
    and c.metric_date <= p_end_date
    and (p_topic is null or c.topic = p_topic)
    and (coalesce(array_length(p_engines, 1), 0) = 0 or c.llm_provider = any(p_engines))
    and (not p_brand_related_only or c.is_brand_related = true)
  group by c.url
  order by sum(coalesce(c.frequency, 1)) desc, c.url asc;
$$;

create or replace function public.get_cumulative_competitors(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_topic text default null,
  p_engines text[] default '{}'::text[]
)
returns table (
  brand_name text,
  website text,
  visibility_score numeric,
  citations bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.brand_name,
         max(c.website) as website,
         avg(c.visibility_score)::numeric as visibility_score,
         sum(coalesce(c.citation_count, 0))::bigint as citations
  from public.competitors c
  where c.project_id = p_project_id
    and c.metric_date >= p_start_date
    and c.metric_date <= p_end_date
    and (p_topic is null or c.topic = p_topic)
    and (coalesce(array_length(p_engines, 1), 0) = 0 or c.llm_provider = any(p_engines))
    and lower(regexp_replace(coalesce(c.brand_name, ''), '^www\.', '')) not in (
      'google.com', 'google.co.uk', 'google.ca', 'google.com.au', 'google.co.in',
      'googleusercontent.com', 'gstatic.com', 'googleapis.com',
      'bing.com', 'search.yahoo.com', 'yahoo.com', 'duckduckgo.com',
      'wikipedia.org', 'en.wikipedia.org', 'facebook.com', 'instagram.com',
      'youtube.com', 'tiktok.com', 'x.com', 'twitter.com', 'linkedin.com',
      'reddit.com', 'goodfirms.co', 'clutch.co'
    )
  group by c.brand_name
  order by sum(coalesce(c.citation_count, 0)) desc, avg(c.visibility_score) desc nulls last;
$$;

create or replace function public.get_latest_competitor_counts(p_project_id uuid)
returns table (topic text, metric_date date, competitor_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with latest as (
    select vd.topic, max(vd.metric_date) as metric_date
    from public.visibility_daily vd
    where vd.project_id = p_project_id and vd.llm_provider = 'Overall'
    group by vd.topic
  )
  select c.topic, c.metric_date, count(distinct c.brand_name)::bigint as competitor_count
  from public.competitors c
  join latest l on l.topic = c.topic and l.metric_date = c.metric_date
  where c.project_id = p_project_id
    and lower(regexp_replace(coalesce(c.brand_name, ''), '^www\.', '')) not in (
      'google.com', 'google.co.uk', 'google.ca', 'google.com.au', 'google.co.in',
      'googleusercontent.com', 'gstatic.com', 'googleapis.com',
      'bing.com', 'search.yahoo.com', 'yahoo.com', 'duckduckgo.com',
      'wikipedia.org', 'en.wikipedia.org', 'facebook.com', 'instagram.com',
      'youtube.com', 'tiktok.com', 'x.com', 'twitter.com', 'linkedin.com',
      'reddit.com', 'goodfirms.co', 'clutch.co'
    )
  group by c.topic, c.metric_date;
$$;

grant execute on function public.get_cumulative_citations(uuid, date, date, text, text[], boolean) to authenticated;
grant execute on function public.get_cumulative_competitors(uuid, date, date, text, text[]) to authenticated;
grant execute on function public.get_latest_competitor_counts(uuid) to authenticated;
