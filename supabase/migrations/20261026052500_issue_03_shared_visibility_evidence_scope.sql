create index if not exists ai_responses_scope_run_valid_idx
  on public.ai_responses (project_id, run_id, tracking_location, llm_provider, response_status)
  include (id, prompt_id, captured_at)
  where response_status = 'completed';

create index if not exists response_brand_evidence_entity_response_idx
  on public.response_brand_evidence (response_id, brand_id, topic);

create or replace view public.response_brand_evidence_scoped as
select
  e.id as evidence_id,
  e.response_id,
  e.project_id,
  e.brand_id as entity_id,
  e.topic,
  (timezone('Asia/Kuala_Lumpur', r.captured_at))::date as metric_date,
  r.llm_provider as provider,
  r.tracking_location,
  r.run_id,
  e.match_source as evidence_type,
  e.matched_value,
  e.evidence_text,
  e.first_position,
  e.occurrence_count,
  e.confidence,
  r.response_status
from public.response_brand_evidence e
join public.ai_responses r on r.id = e.response_id and r.project_id = e.project_id;

comment on view public.response_brand_evidence_scoped is
  'Normalized entity evidence joined to immutable raw AI responses. Scope and run provenance derive from ai_responses; source rows are preserved.';
comment on index public.ai_responses_scope_run_valid_idx is
  'Supports valid raw response denominator reconciliation by project/run/location/provider.';
comment on index public.response_brand_evidence_entity_response_idx is
  'Supports distinct response/entity/topic evidence reconciliation.';
