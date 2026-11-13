-- Read-only replacement preview. Reports the exact canonical predecessor runs
-- and dependent row counts that a future promotion transaction would replace.
create or replace function public.preview_tracking_run_replacement(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate public.tracking_runs%rowtype;
  v_validation jsonb;
  v_date date;
  v_scope jsonb;
  v_predecessors jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_candidate from public.tracking_runs where id = p_run_id;
  if not found then raise exception 'tracking_run_not_found'; end if;

  v_validation := public.validate_tracking_run_candidate(p_run_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then
    return jsonb_build_object(
      'ready_for_promotion', false,
      'validation', v_validation,
      'predecessors', '[]'::jsonb
    );
  end if;

  select (row_data->>'metric_date')::date into v_date
  from public.tracking_run_candidate_rows
  where run_id = p_run_id and table_key = 'visibility_daily'
    and row_data->>'llm_provider' = v_candidate.provider
    and coalesce(row_data->>'category','') <> 'Overall'
  limit 1;

  with candidate_scope as (
    select distinct row_data->>'category' as category,
                    row_data->>'tracking_location' as tracking_location
    from public.tracking_run_candidate_rows
    where run_id = p_run_id and table_key = 'visibility_daily'
      and row_data->>'llm_provider' = v_candidate.provider
      and coalesce(row_data->>'category','') <> 'Overall'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'category', category,
    'tracking_location', tracking_location
  ) order by category, tracking_location), '[]'::jsonb)
  into v_scope from candidate_scope;

  with recursive candidate_scope as (
    select distinct row_data->>'category' as category,
                    row_data->>'tracking_location' as tracking_location
    from public.tracking_run_candidate_rows
    where run_id = p_run_id and table_key = 'visibility_daily'
      and row_data->>'llm_provider' = v_candidate.provider
      and coalesce(row_data->>'category','') <> 'Overall'
  ),
  active_predecessors as (
    select distinct old.id
    from candidate_scope cs
    join public.visibility_daily vd
      on vd.project_id = v_candidate.project_id
     and vd.metric_date = v_date
     and vd.category = cs.category
     and vd.llm_provider = v_candidate.provider
     and vd.tracking_location = cs.tracking_location
    join public.tracking_runs old on old.id = vd.run_id
    where old.id <> p_run_id
      and old.published_at is not null
      and old.status = 'completed'
  ),
  lineage as (
    select old.id, old.project_id, old.provider, old.status, old.category,
           old.tracking_location, old.published_at, old.superseded_at,
           old.supersedes_run_id, 0 as depth
    from public.tracking_runs old
    join active_predecessors ap on ap.id = old.id
    union all
    select parent.id, parent.project_id, parent.provider, parent.status, parent.category,
           parent.tracking_location, parent.published_at, parent.superseded_at,
           parent.supersedes_run_id, child.depth + 1
    from public.tracking_runs parent
    join lineage child on parent.id = child.supersedes_run_id
    where child.depth < 50
  ),
  distinct_lineage as (
    select distinct on (id) * from lineage order by id, depth
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'run_id', l.id,
    'category', l.category,
    'tracking_location', l.tracking_location,
    'status', l.status,
    'published_at', l.published_at,
    'superseded_at', l.superseded_at,
    'lineage_depth', l.depth,
    'raw_responses', (select count(*) from public.ai_responses ar where ar.run_id = l.id),
    'response_brand_evidence', (select count(*) from public.response_brand_evidence e
      join public.ai_responses ar on ar.id = e.response_id where ar.run_id = l.id),
    'citation_occurrences', (select count(*) from public.citation_occurrences co
      join public.ai_responses ar on ar.id = co.response_id where ar.run_id = l.id),
    'third_party_mentions', (select count(*) from public.third_party_mentions tm
      join public.ai_responses ar on ar.id = tm.response_id where ar.run_id = l.id),
    'legacy_citations_in_scope', (select count(*) from public.citations c
      where c.project_id = v_candidate.project_id
        and c.metric_date = v_date
        and c.category = l.category
        and c.llm_provider = v_candidate.provider
        and c.tracking_location = l.tracking_location),
    'legacy_competitors_in_scope', (select count(*) from public.competitors c
      where c.project_id = v_candidate.project_id
        and c.metric_date = v_date
        and c.category = l.category
        and c.llm_provider = v_candidate.provider
        and c.tracking_location = l.tracking_location),
    'category_brand_observations', (select count(*) from public.category_brand_observations o where o.run_id = l.id),
    'visibility_daily', (select count(*) from public.visibility_daily v where v.run_id = l.id),
    'daily_claims', (select count(*) from public.tracking_run_daily_claims c where c.run_id = l.id),
    'batch_category_refs', (select count(*) from public.tracking_batch_categories b where b.tracking_run_id = l.id),
    'source_run_references', (select count(*) from public.tracking_runs x where x.source_run_id = l.id)
  ) order by l.category, l.tracking_location, l.depth), '[]'::jsonb)
  into v_predecessors
  from distinct_lineage l;

  return jsonb_build_object(
    'ready_for_promotion', true,
    'candidate_run_id', p_run_id,
    'project_id', v_candidate.project_id,
    'provider', v_candidate.provider,
    'metric_date', v_date,
    'candidate_scope', v_scope,
    'validation', v_validation,
    'predecessors', v_predecessors,
    'note', 'Read-only preview. No canonical rows or tracking runs were modified.'
  );
end;
$$;

revoke all on function public.preview_tracking_run_replacement(uuid) from public, anon, authenticated;
grant execute on function public.preview_tracking_run_replacement(uuid) to service_role;
