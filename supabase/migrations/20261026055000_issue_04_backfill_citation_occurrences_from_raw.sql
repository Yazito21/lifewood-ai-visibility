-- Idempotently backfill normalized citations from retained raw response annotations.
with raw_citations as (
  select r.id as response_id, r.project_id, p.topic,
    (timezone('Asia/Kuala_Lumpur', r.captured_at))::date as metric_date,
    r.llm_provider as provider, r.tracking_location, r.run_id,
    a->>'url' as citation_url,
    public.canonicalize_citation_url(a->>'url') as canonical_url
  from public.ai_responses r
  join public.prompts p on p.id=r.prompt_id and p.project_id=r.project_id
  cross join lateral jsonb_array_elements(coalesce(r.raw_response->'output','[]'::jsonb)) out_item
  cross join lateral jsonb_array_elements(coalesce(out_item->'content','[]'::jsonb)) content_item
  cross join lateral jsonb_array_elements(coalesce(content_item->'annotations','[]'::jsonb)) a
  where r.response_status='completed' and out_item->>'type'='message'
    and a->>'type'='url_citation' and a->>'url' ~* '^https?://'
    and p.topic is not null
),
normalized as (
  select distinct rc.*,
    regexp_replace(lower(split_part(split_part(rc.canonical_url,'/',3),':',1)),'^www\.', '') as canonical_domain
  from raw_citations rc where rc.canonical_url is not null and rc.canonical_url <> ''
),
attributed as (
  select distinct n.project_id,n.response_id,a.brand_id as entity_id,n.topic,n.metric_date,
    n.provider,n.tracking_location,n.run_id,n.citation_url,n.canonical_url,n.canonical_domain,1 as citation_index
  from normalized n
  join public.topic_brand_assignments a on a.project_id=n.project_id and a.topic=n.topic and a.include_in_metrics=true
  join public.brand_registry br on br.id=a.brand_id and br.project_id=a.project_id and br.is_active=true
  cross join lateral unnest(array_cat(
    coalesce(a.websites,array[]::text[]),
    array_cat(case when nullif(br.primary_website,'') is null then array[]::text[] else array[br.primary_website] end,
              coalesce(br.additional_websites,array[]::text[]))
  )) as registered_site(site)
  where n.canonical_domain=regexp_replace(lower(split_part(split_part(regexp_replace(registered_site.site,'^https?://','','i'),'/',1),':',1)),'^www\.', '')
     or n.canonical_domain like '%.' || regexp_replace(lower(split_part(split_part(regexp_replace(registered_site.site,'^https?://','','i'),'/',1),':',1)),'^www\.', '')
)
insert into public.citation_occurrences (
  project_id,response_id,entity_id,topic,metric_date,provider,tracking_location,run_id,
  citation_url,canonical_url,canonical_domain,citation_index
)
select project_id,response_id,entity_id,topic,metric_date,provider,tracking_location,run_id,
  citation_url,canonical_url,canonical_domain,citation_index
from attributed
on conflict (response_id,entity_id,canonical_url) do nothing;
