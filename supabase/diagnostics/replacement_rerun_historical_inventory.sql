-- READ-ONLY historical replacement lineage inventory.
-- Safe to run as a SELECT-only diagnostic. This query does not mutate data.
-- It intentionally reports candidate history; it does not declare any row safe to delete.
with run_scope as (
  select
    tr.id as run_id,
    tr.project_id,
    p.brand_name,
    (coalesce(tr.published_at, tr.completed_at, tr.started_at) at time zone 'Asia/Kuala_Lumpur')::date as metric_date,
    tr.category,
    tr.provider,
    tr.tracking_location,
    tr.run_kind,
    tr.status,
    tr.published_at,
    tr.superseded_at,
    tr.source_run_id,
    tr.supersedes_run_id,
    tr.data_source,
    tr.import_batch,
    tr.total_prompts,
    tr.completed_prompts,
    tr.failed_prompts
  from public.tracking_runs tr
  join public.projects p on p.id = tr.project_id
  where tr.run_kind in ('topic', 'full', 'overall_aggregate')
    and (tr.published_at is not null or tr.status = 'completed')
),
scope_summary as (
  select
    project_id, brand_name, metric_date, category, provider, tracking_location,
    count(*)::integer as run_count,
    count(*) filter (where published_at is not null and superseded_at is null)::integer as active_published_run_count,
    count(*) filter (where published_at is not null and superseded_at is not null)::integer as superseded_published_run_count,
    array_agg(run_id order by published_at nulls first, run_id) as run_ids,
    array_agg(run_id order by published_at, run_id)
      filter (where published_at is not null and superseded_at is not null) as superseded_run_ids,
    array_agg(run_id order by published_at desc nulls last, run_id desc)
      filter (where published_at is not null and superseded_at is null) as active_run_ids,
    array_agg(distinct source_run_id) filter (where source_run_id is not null) as source_run_ids
  from run_scope
  group by project_id, brand_name, metric_date, category, provider, tracking_location
),
scope_counts as (
  select
    s.project_id, s.brand_name, s.metric_date, s.category, s.provider, s.tracking_location,
    s.run_count, s.active_published_run_count, s.superseded_published_run_count,
    s.run_ids, s.superseded_run_ids, s.active_run_ids, s.source_run_ids,
    (select count(distinct ar.id)::integer
       from public.ai_responses ar
       join run_scope rs on rs.run_id = ar.run_id or rs.source_run_id = ar.run_id
      where rs.project_id = s.project_id and rs.metric_date = s.metric_date
        and rs.category is not distinct from s.category and rs.provider = s.provider
        and rs.tracking_location = s.tracking_location) as raw_response_rows,
    (select count(distinct e.id)::integer
       from public.response_brand_evidence e
       join public.ai_responses ar on ar.id = e.response_id
       join run_scope rs on rs.run_id = ar.run_id or rs.source_run_id = ar.run_id
      where rs.project_id = s.project_id and rs.metric_date = s.metric_date
        and rs.category is not distinct from s.category and rs.provider = s.provider
        and rs.tracking_location = s.tracking_location) as response_evidence_rows,
    (select count(*)::integer
       from public.citation_occurrences co
      where co.project_id = s.project_id and co.metric_date = s.metric_date
        and co.category is not distinct from s.category and co.provider = s.provider
        and co.tracking_location = s.tracking_location) as citation_occurrence_rows,
    (select count(*)::integer
       from public.category_brand_observations o
      where o.project_id = s.project_id and o.metric_date = s.metric_date
        and o.category is not distinct from s.category and o.llm_provider = s.provider
        and o.tracking_location = s.tracking_location) as competitor_observation_rows,
    (select count(*)::integer
       from public.visibility_daily v
      where v.project_id = s.project_id and v.metric_date = s.metric_date
        and v.category is not distinct from s.category and v.llm_provider = s.provider
        and v.tracking_location = s.tracking_location) as visibility_metric_rows,
    (select count(distinct rr.id)::integer
       from public.tracking_run_replacements rr
       join run_scope rs on rs.run_id = rr.replaced_run_id or rs.run_id = rr.replacement_run_id
      where rs.project_id = s.project_id and rs.metric_date = s.metric_date
        and rs.category is not distinct from s.category and rs.provider = s.provider
        and rs.tracking_location = s.tracking_location) as replacement_audit_rows
  from scope_summary s
)
select *
from scope_counts
order by brand_name, metric_date desc, category nulls first, provider, tracking_location;
