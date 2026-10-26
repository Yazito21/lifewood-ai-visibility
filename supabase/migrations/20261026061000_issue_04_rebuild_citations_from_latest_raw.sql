-- Rebuild citation URL-frequency aggregates from latest completed raw response per prompt.
-- The raw ai_responses table remains unchanged.
delete from public.citations;

with latest_responses as (
  select distinct on (
    r.project_id,(timezone('Asia/Kuala_Lumpur',r.captured_at))::date,
    p.topic,r.llm_provider,r.tracking_location,r.prompt_id
  ) r.id as response_id,r.project_id,
    (timezone('Asia/Kuala_Lumpur',r.captured_at))::date as metric_date,
    p.topic,r.llm_provider,r.tracking_location,r.prompt_id,r.raw_response,
    pr.brand_name,coalesce(pr.brand_domains,array[]::text[]) as brand_domains
  from public.ai_responses r
  join public.prompts p on p.id=r.prompt_id and p.project_id=r.project_id
  join public.projects pr on pr.id=r.project_id
  where r.response_status='completed'
  order by r.project_id,(timezone('Asia/Kuala_Lumpur',r.captured_at))::date,
    p.topic,r.llm_provider,r.tracking_location,r.prompt_id,r.captured_at desc,r.id desc
),
raw_citations as (
  select lr.response_id,lr.project_id,lr.metric_date,lr.topic,lr.llm_provider,lr.tracking_location,lr.prompt_id,
    lr.brand_name,lr.brand_domains,a->>'url' as source_url,
    coalesce(nullif(a->>'title',''),nullif(split_part(split_part(a->>'url','/',3),'.',1),'')) as source_title,
    public.canonicalize_citation_url(a->>'url') as canonical_url
  from latest_responses lr
  cross join lateral jsonb_array_elements(coalesce(lr.raw_response->'output','[]'::jsonb)) out_item
  cross join lateral jsonb_array_elements(coalesce(out_item->'content','[]'::jsonb)) content_item
  cross join lateral jsonb_array_elements(coalesce(content_item->'annotations','[]'::jsonb)) a
  where out_item->>'type'='message' and a->>'type'='url_citation' and a->>'url' ~* '^https?://'
),
per_response_url as (
  select distinct rc.response_id,rc.project_id,rc.metric_date,rc.topic,rc.llm_provider,rc.tracking_location,rc.prompt_id,
    rc.brand_name,rc.brand_domains,rc.canonical_url,
    regexp_replace(lower(split_part(split_part(rc.canonical_url,'/',3),':',1)),'^www\.', '') as canonical_domain,
    max(rc.source_title) over (partition by rc.response_id,rc.canonical_url) as page_name
  from raw_citations rc where rc.canonical_url is not null and rc.canonical_url<>''
),
attributed as (
  select pru.*,
    exists (select 1 from unnest(pru.brand_domains) d(domain)
      where pru.canonical_domain=regexp_replace(lower(split_part(split_part(regexp_replace(d.domain,'^https?://','','i'),'/',1),':',1)),'^www\.', '')
        or pru.canonical_domain like '%.' || regexp_replace(lower(split_part(split_part(regexp_replace(d.domain,'^https?://','','i'),'/',1),':',1)),'^www\.', '')
    ) as is_brand_related
  from per_response_url pru
),
aggregated as (
  select project_id,metric_date,topic,llm_provider as provider,tracking_location,canonical_url,
    max(page_name) as page_name,
    max(case when is_brand_related then brand_name else canonical_domain end) as brand_name,
    bool_or(is_brand_related) as is_brand_related,
    count(*)::integer as frequency,
    max(prompt_id::text)::uuid as prompt_id
  from attributed
  group by project_id,metric_date,topic,llm_provider,tracking_location,canonical_url
)
insert into public.citations(project_id,metric_date,topic,llm_provider,tracking_location,url,page_name,brand_name,is_brand_related,frequency,prompt_id)
select project_id,metric_date,topic,provider,tracking_location,canonical_url,page_name,brand_name,is_brand_related,frequency,prompt_id
from aggregated;
