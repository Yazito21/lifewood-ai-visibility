-- READ-ONLY per-run dependency detail for historical replacement review.
-- Includes superseded runs, completed-unpublished legacy full sources, and failed/partial unpublished runs.
-- This query is diagnostic only; it does not modify or delete any records.
with candidate_runs as (
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
    coalesce(tr.source_run_id, tr.id) as response_owner_run_id
  from public.tracking_runs tr
  join public.projects p on p.id = tr.project_id
  where tr.run_kind in ('topic', 'full', 'overall_aggregate')
    and (
      tr.superseded_at is not null
      or (tr.run_kind = 'full' and tr.status = 'completed' and tr.published_at is null)
      or (tr.status in ('failed', 'partial') and tr.published_at is null)
    )
)
select
  r.project_id,
  r.brand_name,
  r.metric_date,
  r.category,
  r.provider,
  r.tracking_location,
  r.run_kind,
  r.run_id,
  r.status,
  r.published_at,
  r.superseded_at,
  r.source_run_id,
  r.supersedes_run_id,
  (select count(*)::integer
     from public.ai_responses ar
    where ar.run_id = r.run_id) as direct_raw_response_rows,
  (select count(*)::integer
     from public.ai_responses ar
    where ar.run_id = r.response_owner_run_id) as source_response_rows_shared,
  (select count(distinct e.id)::integer
     from public.response_brand_evidence e
     join public.ai_responses ar on ar.id = e.response_id
    where ar.run_id = r.response_owner_run_id
      and e.project_id = r.project_id
      and (r.category is null or e.category = r.category)) as response_brand_evidence_rows,
  (select count(*)::integer
     from public.citation_occurrences co
    where co.project_id = r.project_id
      and co.metric_date = r.metric_date
      and co.category is not distinct from r.category
      and co.provider = r.provider
      and co.tracking_location = r.tracking_location
      and (co.run_id = r.run_id or co.run_id = r.source_run_id)) as citation_occurrence_rows,
  (select count(*)::integer
     from public.third_party_mentions tm
     join public.ai_responses ar on ar.id = tm.response_id
    where ar.run_id = r.response_owner_run_id
      and tm.project_id = r.project_id
      and tm.metric_date = r.metric_date
      and tm.category is not distinct from r.category
      and tm.llm_provider = r.provider
      and tm.tracking_location = r.tracking_location) as third_party_mention_rows,
  (select count(*)::integer
     from public.category_brand_observations o
    where o.run_id = r.run_id) as competitor_observation_rows,
  (select count(*)::integer
     from public.visibility_daily v
    where v.run_id = r.run_id) as visibility_metric_rows,
  (select count(*)::integer
     from public.tracking_runs child
    where child.source_run_id = r.run_id) as source_run_child_references,
  (select count(*)::integer
     from public.tracking_runs child
    where child.supersedes_run_id = r.run_id) as supersedes_child_references,
  (select count(*)::integer
     from public.tracking_run_stages s
    where s.run_id = r.run_id) as run_stage_rows,
  (select count(*)::integer
     from public.tracking_run_daily_claims c
    where c.run_id = r.run_id) as daily_claim_rows,
  (select count(*)::integer
     from public.tracking_batch_categories bc
    where bc.tracking_run_id = r.run_id) as batch_category_references,
  null::integer as replacement_audit_rows -- replacement audit table is not deployed in the current Production schema
from candidate_runs r
order by r.brand_name, r.metric_date desc, r.run_kind, r.category nulls first,
         r.provider, r.status, r.run_id;
