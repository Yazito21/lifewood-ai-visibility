-- Synthetic behavioural tests for candidate staging and validation.
-- Runs only against the disposable local Supabase database in GitHub Actions.
-- No hosted project or customer data is accessed.

begin;

set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  v_project uuid;
  v_prompt uuid;
  v_run uuid;
  v_result jsonb;
  v_metric_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Replacement Test Brand', array['Skin'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Synthetic test prompt', 'Skin', 'English', true)
  returning id into v_prompt;

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'topic'
  ) returning id into v_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'chatgpt', now(), 'Synthetic test prompt',
    '{}'::jsonb, 'Synthetic completed response', 'completed', v_run, 'MY'
  );

  perform public.stage_tracking_candidate_rows(
    v_run,
    'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project,
      'metric_date', v_metric_date,
      'category', 'Skin',
      'llm_provider', 'chatgpt',
      'tracking_location', 'MY',
      'run_id', v_run,
      'visibility_score', 12.5,
      'visibility_rank', 1,
      'citation_count', 0,
      'presence_count', 1,
      'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_run;

  v_result := public.validate_tracking_run_candidate(v_run);
  if coalesce((v_result->>'valid')::boolean, false) is not true then
    raise exception 'expected synthetic candidate to validate, got: %', v_result;
  end if;

  -- Validation is read-only: canonical tables must remain untouched.

  if exists (select 1 from public.visibility_daily where project_id = v_project) then
    raise exception 'candidate validation unexpectedly wrote canonical visibility rows';
  end if;

  if exists (select 1 from public.citations where project_id = v_project) then
    raise exception 'candidate validation unexpectedly wrote canonical citation rows';
  end if;
end
$$;

rollback;

select 'replacement rerun candidate validation behavioural tests passed' as result;
