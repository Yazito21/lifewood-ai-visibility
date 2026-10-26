-- Recompute citation metrics from normalized response/entity citation evidence.
-- Only update scopes with completed raw responses at that exact reporting grain.
update public.visibility_daily vd
set citation_count = coalesce((
  select c.citation_occurrences
  from public.get_scoped_citation_occurrence_counts(
    vd.project_id, vd.metric_date, vd.metric_date,
    case when vd.topic='Overall' then null else vd.topic end,
    case when vd.llm_provider='Overall' then array['chatgpt']::text[] else array[vd.llm_provider]::text[] end,
    vd.tracking_location
  ) c
  where c.entity_id = (
    select br.id from public.brand_registry br
    where br.project_id=vd.project_id and br.is_tracked_brand=true and br.is_active=true
    order by br.updated_at desc limit 1
  )
),0)
where exists (
  select 1 from public.ai_responses r
  join public.prompts p on p.id=r.prompt_id and p.project_id=r.project_id
  where r.project_id=vd.project_id
    and (timezone('Asia/Kuala_Lumpur',r.captured_at))::date=vd.metric_date
    and r.tracking_location=vd.tracking_location and r.response_status='completed'
    and r.llm_provider=case when vd.llm_provider='Overall' then 'chatgpt' else vd.llm_provider end
    and (vd.topic='Overall' or p.topic=vd.topic)
);

update public.topic_brand_observations o
set citation_count = coalesce((
  select c.citation_occurrences
  from public.get_scoped_citation_occurrence_counts(
    o.project_id,o.metric_date,o.metric_date,
    case when o.topic='Overall' then null else o.topic end,
    array[o.llm_provider]::text[],o.tracking_location
  ) c where c.entity_id=o.brand_id
),0)
where exists (
  select 1 from public.ai_responses r
  join public.prompts p on p.id=r.prompt_id and p.project_id=r.project_id
  where r.project_id=o.project_id
    and (timezone('Asia/Kuala_Lumpur',r.captured_at))::date=o.metric_date
    and r.tracking_location=o.tracking_location and r.response_status='completed'
    and r.llm_provider=o.llm_provider and (o.topic='Overall' or p.topic=o.topic)
);
