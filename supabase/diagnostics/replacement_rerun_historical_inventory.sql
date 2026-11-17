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
    tr.started_at,
    tr.completed_at,
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
),
scope_summary as (
  select
    project_id, brand_name, metric_date, category, provider, tracking_location, run_kind,
    count(*)::integer as run_count,
    count(*) filter (where published_at is not null and superseded_at is null)::integer as active_published_run_count,
    count(*) filter (where superseded_at is not null)::integer as superseded_run_count,
    count(*) filter (where published_at is not null and superseded_at is not null)::integer as superseded_published_run_count,
    count(*) filter (where superseded_at is not null and published_at is null)::integer as superseded_unpublished_run_count,
    count(*) filter (where status = 'completed' and published_at is null and superseded_at is null)::integer as completed_unpublished_run_count,
    count(*) filter (where status = 'failed' and published_at is null)::integer as failed_unpublished_run_count,
    count(*) filter (where status = 'partial' and published_at is null)::integer as partial_unpublished_run_count,
    count(*) filter (where status in ('queued','running') and published_at is null)::integer as in_progress_run_count,
    array_agg(run_id order by published_at nulls first, run_id) as run_ids,
    array_agg(run_id order by published_at, run_id)
      filter (where superseded_at is not null) as superseded_run_ids,
    array_agg(run_id order by published_at, run_id)
      filter (where published_at is not null and superseded_at is not null) as superseded_published_run_ids,
    array_agg(run_id order by published_at desc nulls last, run_id desc)
      filter (where published_at is not null and superseded_at is null) as active_run_ids,
    array_agg(run_id order by completed_at nulls first, run_id)
      filter (where status = 'completed' and published_at is null and superseded_at is null) as completed_unpublished_run_ids,
    array_agg(run_id order by completed_at nulls first, run_id)
      filter (where status = 'failed' and published_at is null) as failed_unpublished_run_ids,
    array_agg(run_id order by completed_at nulls first, run_id)
      filter (where status = 'partial' and published_at is null) as partial_unpublished_run_ids,
    array_agg(run_id order by started_at nulls first, run_id)
      filter (where status in ('queued','running') and published_at is null) as in_progress_run_ids,
    array_agg(distinct source_run_id) filter (where source_run_id is not null) as source_run_ids,
    array_agg(distinct data_source) filter (where data_source is not null) as data_sources,
    array_agg(distinct import_batch) filter (where import_batch is not null) as import_batches
  from run_scope
  group by project_id, brand_name, metric_date, category, provider, tracking_location, run_kind
),
scope_counts as (
  select
    s.project_id, s.brand_name, s.metric_date, s.category, s.provider, s.tracking_location, s.run_kind,
    s.run_count, s.active_published_run_count, s.superseded_run_count, s.superseded_published_run_count,
    s.superseded_unpublished_run_count, s.completed_unpublished_run_count, s.failed_unpublished_run_count,
    s.partial_unpublished_run_count, s.in_progress_run_count,
    s.run_ids, s.superseded_run_ids, s.superseded_published_run_ids, s.active_run_ids,
    s.completed_unpublished_run_ids, s.failed_unpublished_run_ids, s.partial_unpublished_run_ids, s.in_progress_run_ids,
    s.source_run_ids, s.data_sources, s.import_batches,
    (select count(distinct ar.id)::integer
       from public.ai_responses ar
       join run_scope rs on rs.run_id = ar.run_id or rs.source_run_id = ar.run_id
      where rs.project_id = s.project_id and rs.metric_date = s.metric_date
        and rs.category is not distinct from s.category and rs.provider = s.provider
        and rs.tracking_location = s.tracking_location and rs.run_kind = s.run_kind) as source_response_rows_shared,
    (select count(distinct ar.id)::integer
       from public.ai_responses ar
       join public.prompts pr on pr.id = ar.prompt_id
       join run_scope rs on rs.run_id = ar.run_id or rs.source_run_id = ar.run_id
      where rs.project_id = s.project_id and rs.metric_date = s.metric_date
        and rs.category is not distinct from s.category and rs.provider = s.provider
        and rs.tracking_location = s.tracking_location and rs.run_kind = s.run_kind
        and (s.category is null or pr.category = s.category)) as prompt_linked_response_rows,
    (select count(distinct e.id)::integer
       from public.response_brand_evidence e
       join public.ai_responses ar on ar.id = e.response_id
       join run_scope rs on rs.run_id = ar.run_id or rs.source_run_id = ar.run_id
      where rs.project_id = s.project_id and rs.metric_date = s.metric_date
        and rs.category is not distinct from s.category and rs.provider = s.provider
        and rs.tracking_location = s.tracking_location and rs.run_kind = s.run_kind
        and (s.category is null or e.category = s.category)) as response_evidence_rows,
    case when s.run_kind = 'topic' then (select count(*)::integer
       from public.citation_occurrences co
      where co.project_id = s.project_id and co.metric_date = s.metric_date
        and co.category is not distinct from s.category and co.provider = s.provider
        and co.tracking_location = s.tracking_location
        and co.run_id in (
          select rs.run_id from run_scope rs
          where rs.project_id = s.project_id and rs.metric_date = s.metric_date
            and rs.category is not distinct from s.category and rs.provider = s.provider
            and rs.tracking_location = s.tracking_location and rs.run_kind = s.run_kind
          union
          select rs.source_run_id from run_scope rs
          where rs.project_id = s.project_id and rs.metric_date = s.metric_date
            and rs.category is not distinct from s.category and rs.provider = s.provider
            and rs.tracking_location = s.tracking_location and rs.run_kind = s.run_kind
            and rs.source_run_id is not null
        )) end as citation_occurrence_rows,
    (select count(*)::integer
       from public.category_brand_observations o
      where o.project_id = s.project_id and o.metric_date = s.metric_date
        and o.category is not distinct from s.category and o.llm_provider = s.provider
        and o.tracking_location = s.tracking_location
        and o.run_id in (
          select rs.run_id from run_scope rs
          where rs.project_id = s.project_id and rs.metric_date = s.metric_date
            and rs.category is not distinct from s.category and rs.provider = s.provider
            and rs.tracking_location = s.tracking_location and rs.run_kind = s.run_kind
        )) as competitor_observation_rows,
    (select count(*)::integer
       from public.citations c
      where c.project_id = s.project_id and c.metric_date = s.metric_date
        and c.category is not distinct from s.category and c.llm_provider = s.provider
        and c.tracking_location = s.tracking_location) as legacy_citation_rows,
    (select count(*)::integer
       from public.competitors c
      where c.project_id = s.project_id and c.metric_date = s.metric_date
        and c.category is not distinct from s.category and c.llm_provider = s.provider
        and c.tracking_location = s.tracking_location) as legacy_competitor_rows,
    (select count(*)::integer
       from public.direct_competitor_observations o
       join public.direct_competitors dc on dc.id = o.competitor_id and dc.project_id = o.project_id
      where o.project_id = s.project_id and o.metric_date = s.metric_date
        and o.llm_provider = s.provider and o.tracking_location = s.tracking_location
        and dc.category is not distinct from s.category) as direct_competitor_observation_rows,
    (select count(*)::integer
       from public.direct_competitors dc
      where dc.project_id = s.project_id and dc.category is not distinct from s.category
    ) as direct_competitor_registry_rows,
    (select count(*)::integer
       from public.visibility_daily v
      where v.project_id = s.project_id and v.metric_date = s.metric_date
        and v.category is not distinct from s.category
        and v.tracking_location = s.tracking_location
        and v.run_id in (
          select rs.run_id from run_scope rs
          where rs.project_id = s.project_id and rs.metric_date = s.metric_date
            and rs.category is not distinct from s.category and rs.provider = s.provider
            and rs.tracking_location = s.tracking_location and rs.run_kind = s.run_kind
        )) as visibility_metric_rows,
    null::integer as replacement_audit_rows -- audit table is introduced by the pending replacement migration
  from scope_summary s
)
select *
from scope_counts
order by brand_name, metric_date desc, category nulls first, run_kind, provider, tracking_location;
