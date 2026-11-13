-- Read-only candidate validation gate. This RPC deliberately performs no publication,
-- canonical writes, predecessor deletion, or other mutation.
create or replace function public.validate_tracking_run_candidate(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.tracking_runs%rowtype;
  v_project_categories text[];
  v_expected_categories text[];
  v_actual_categories text[];
  v_expected_locations text[];
  v_metric_locations text[];
  v_dates date[];
  v_response_count integer;
  v_completed_response_count integer;
  v_metric_count integer;
  v_expected_metric_count integer;
  v_staged_project_mismatch integer;
  v_staged_date_mismatch integer;
  v_staged_scope_mismatch integer;
  v_errors text[] := array[]::text[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_run
  from public.tracking_runs
  where id = p_run_id
  for share;

  if not found then
    raise exception 'tracking_run_not_found';
  end if;

  if v_run.status <> 'completed' then
    v_errors := array_append(v_errors, 'candidate_run_not_completed');
  end if;
  if v_run.published_at is not null then
    v_errors := array_append(v_errors, 'candidate_already_published');
  end if;
  if v_run.run_kind = 'overall_aggregate' then
    v_errors := array_append(v_errors, 'overall_aggregate_cannot_be_candidate');
  end if;

  select p.categories into v_project_categories
  from public.projects p where p.id = v_run.project_id;

  if v_run.category is not null then
    v_expected_categories := array[v_run.category];
  else
    select coalesce(array_agg(x order by x), array[]::text[])
      into v_expected_categories
    from unnest(coalesce(v_project_categories, array[]::text[])) x
    where x <> 'Overall';
  end if;

  select count(*)::integer,
         count(*) filter (where ar.response_status = 'completed')::integer,
         coalesce(array_agg(distinct ar.tracking_location order by ar.tracking_location)
           filter (where ar.tracking_location is not null), array[]::text[])
    into v_response_count, v_completed_response_count, v_expected_locations
  from public.ai_responses ar
  where ar.run_id = p_run_id;

  if v_response_count <> v_run.completed_prompts then
    v_errors := array_append(v_errors, 'raw_response_count_does_not_match_completed_prompts');
  end if;
  if v_completed_response_count <> v_run.completed_prompts then
    v_errors := array_append(v_errors, 'candidate_contains_non_completed_response');
  end if;
  if coalesce(cardinality(v_expected_locations), 0) = 0 then
    v_errors := array_append(v_errors, 'candidate_has_no_tracking_locations');
  end if;

  select coalesce(array_agg(distinct row_data->>'category' order by row_data->>'category'), array[]::text[]),
         coalesce(array_agg(distinct row_data->>'tracking_location' order by row_data->>'tracking_location'), array[]::text[]),
         coalesce(array_agg(distinct (row_data->>'metric_date')::date order by (row_data->>'metric_date')::date), array[]::date[]),
         count(*)::integer
    into v_actual_categories, v_metric_locations, v_dates, v_metric_count
  from public.tracking_run_candidate_rows
  where run_id = p_run_id and table_key = 'visibility_daily'
    and row_data->>'llm_provider' = v_run.provider;

  if v_actual_categories is distinct from v_expected_categories then
    v_errors := array_append(v_errors, 'candidate_category_coverage_mismatch');
  end if;
  if v_metric_locations is distinct from v_expected_locations then
    v_errors := array_append(v_errors, 'candidate_location_coverage_mismatch');
  end if;
  if coalesce(cardinality(v_dates), 0) <> 1 then
    v_errors := array_append(v_errors, 'candidate_must_have_exactly_one_metric_date');
  end if;

  v_expected_metric_count := coalesce(cardinality(v_expected_categories), 0)
    * coalesce(cardinality(v_expected_locations), 0);
  if v_metric_count <> v_expected_metric_count then
    v_errors := array_append(v_errors, 'candidate_metric_row_count_mismatch');
  end if;

  select count(*)::integer into v_staged_project_mismatch
  from public.tracking_run_candidate_rows
  where run_id = p_run_id
    and row_data ? 'project_id'
    and nullif(row_data->>'project_id', '')::uuid is distinct from v_run.project_id;
  if v_staged_project_mismatch > 0 then
    v_errors := array_append(v_errors, 'staged_project_scope_mismatch');
  end if;

  select count(*)::integer into v_staged_scope_mismatch
  from public.tracking_run_candidate_rows
  where run_id = p_run_id
    and row_data ? 'tracking_location'
    and not (row_data->>'tracking_location' = any(v_expected_locations));
  if v_staged_scope_mismatch > 0 then
    v_errors := array_append(v_errors, 'staged_location_scope_mismatch');
  end if;

  if coalesce(cardinality(v_dates), 0) = 1 then
    select count(*)::integer into v_staged_date_mismatch
    from public.tracking_run_candidate_rows
    where run_id = p_run_id
      and row_data ? 'metric_date'
      and (row_data->>'metric_date')::date <> v_dates[1];
    if v_staged_date_mismatch > 0 then
      v_errors := array_append(v_errors, 'staged_metric_date_mismatch');
    end if;
  end if;

  return jsonb_build_object(
    'valid', cardinality(v_errors) = 0,
    'run_id', p_run_id,
    'project_id', v_run.project_id,
    'run_kind', v_run.run_kind,
    'category_scope', v_run.category,
    'metric_dates', to_jsonb(v_dates),
    'categories', to_jsonb(v_actual_categories),
    'locations', to_jsonb(v_metric_locations),
    'raw_response_count', v_response_count,
    'completed_response_count', v_completed_response_count,
    'completed_prompts', v_run.completed_prompts,
    'metric_rows', v_metric_count,
    'expected_metric_rows', v_expected_metric_count,
    'errors', to_jsonb(v_errors)
  );
end;
$$;

revoke all on function public.validate_tracking_run_candidate(uuid) from public, anon, authenticated;
grant execute on function public.validate_tracking_run_candidate(uuid) to service_role;
