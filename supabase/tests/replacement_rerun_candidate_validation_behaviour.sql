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
  v_bad_provider_run uuid;
  v_bad_prompt_run uuid;
  v_other_category_prompt uuid;
  v_other_project uuid;
  v_bad_project_run uuid;
  v_bad_location_run uuid;
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

  -- A matching row count must not allow raw responses from another provider.
  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'topic'
  ) returning id into v_bad_provider_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'gemini', now(), 'Synthetic test prompt',
    '{}'::jsonb, 'Wrong-provider response', 'completed', v_bad_provider_run, 'MY'
  );

  perform public.stage_tracking_candidate_rows(v_bad_provider_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', v_bad_provider_run,
      'visibility_score', 1, 'citation_count', 0, 'presence_count', 0, 'response_count', 1
    )));
  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_bad_provider_run;

  v_result := public.validate_tracking_run_candidate(v_bad_provider_run);
  if not (v_result->'errors' ? 'raw_response_project_provider_prompt_or_location_scope_mismatch') then
    raise exception 'candidate validation accepted a raw response from the wrong provider: %', v_result;
  end if;

  -- A response must also reference a prompt owned by the project and category.
  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 2, 'Synthetic wrong-category prompt', 'Mind', 'English', true)
  returning id into v_other_category_prompt;

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'topic'
  ) returning id into v_bad_prompt_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_other_category_prompt, 'chatgpt', now(), 'Synthetic wrong-category prompt',
    '{}'::jsonb, 'Wrong-category response', 'completed', v_bad_prompt_run, 'MY'
  );

  perform public.stage_tracking_candidate_rows(v_bad_prompt_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', v_bad_prompt_run,
      'visibility_score', 1, 'citation_count', 0, 'presence_count', 0, 'response_count', 1
    )));
  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_bad_prompt_run;

  v_result := public.validate_tracking_run_candidate(v_bad_prompt_run);
  if not (v_result->'errors' ? 'raw_response_project_provider_prompt_or_location_scope_mismatch') then
    raise exception 'candidate validation accepted a response from a prompt in another category: %', v_result;
  end if;

  -- The raw response's project_id must match the candidate even if its prompt_id
  -- happens to point at a valid prompt in the candidate project.
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Foreign Response Project', array['Skin'], 'MY', array['MY'])
  returning id into v_other_project;

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'topic'
  ) returning id into v_bad_project_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_other_project, v_prompt, 'chatgpt', now(), 'Synthetic test prompt',
    '{}'::jsonb, 'Wrong-project response', 'completed', v_bad_project_run, 'MY'
  );

  perform public.stage_tracking_candidate_rows(v_bad_project_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', v_bad_project_run,
      'visibility_score', 1, 'citation_count', 0, 'presence_count', 0, 'response_count', 1
    )));
  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_bad_project_run;

  v_result := public.validate_tracking_run_candidate(v_bad_project_run);
  if not (v_result->'errors' ? 'raw_response_project_provider_prompt_or_location_scope_mismatch') then
    raise exception 'candidate validation accepted a raw response from another project: %', v_result;
  end if;

  -- A candidate must not widen replacement to a second, unconfigured location.
  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 2, 0,
    now(), null, 'MY', 'Skin', 'topic'
  ) returning id into v_bad_location_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values
    (v_project, v_prompt, 'chatgpt', now(), 'Synthetic test prompt',
     '{}'::jsonb, 'Malaysia response', 'completed', v_bad_location_run, 'MY'),
    (v_project, v_prompt, 'chatgpt', now(), 'Synthetic test prompt',
     '{}'::jsonb, 'Foreign location response', 'completed', v_bad_location_run, 'SG');

  perform public.stage_tracking_candidate_rows(v_bad_location_run, 'visibility_daily',
    jsonb_build_array(
      jsonb_build_object(
        'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
        'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', v_bad_location_run,
        'visibility_score', 1, 'citation_count', 0, 'presence_count', 0, 'response_count', 1
      ),
      jsonb_build_object(
        'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
        'llm_provider', 'chatgpt', 'tracking_location', 'SG', 'run_id', v_bad_location_run,
        'visibility_score', 1, 'citation_count', 0, 'presence_count', 0, 'response_count', 1
      )
    ));
  update public.tracking_runs
  set status = 'completed', completed_prompts = 2, completed_at = now()
  where id = v_bad_location_run;

  v_result := public.validate_tracking_run_candidate(v_bad_location_run);
  if not (v_result->'errors' ? 'candidate_tracking_location_does_not_match_single_project_location') then
    raise exception 'candidate validation accepted an unconfigured second tracking location: %', v_result;
  end if;
end
$$;

rollback;

select 'replacement rerun candidate validation behavioural tests passed' as result;
