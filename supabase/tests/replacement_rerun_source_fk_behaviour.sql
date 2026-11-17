-- Behavioural test: replacement fails closed when a predecessor is referenced
-- by tracking_runs.source_run_id (NO ACTION FK).
-- Runs only in the disposable local Supabase database in GitHub Actions.

begin;
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  v_project uuid;
  v_prompt uuid;
  v_old_run uuid;
  v_child_run uuid;
  v_new_run uuid;
  v_old_response uuid;
  v_new_response uuid;
  v_result jsonb;
  v_error text;
  v_metric_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Source FK Brand', array['Skin'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Source FK prompt', 'Skin', 'English', true)
  returning id into v_prompt;

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'topic'
  ) returning id into v_old_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'chatgpt', now(), 'Source FK prompt',
    '{"generation":"predecessor"}'::jsonb, 'Predecessor response',
    'completed', v_old_run, 'MY'
  ) returning id into v_old_response;

  perform public.stage_tracking_candidate_rows(v_old_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', v_old_run,
      'visibility_score', 0, 'visibility_rank', null, 'rank_population_count', null,
      'rank_population_status', 'unverified', 'citation_count', 0, 'presence_count', 0, 'response_count', 1
    )));
  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_old_run;

  v_result := public.promote_tracking_run_candidate(v_old_run, null);
  if v_result->>'status' <> 'published' then
    raise exception 'source FK predecessor did not publish: %', v_result;
  end if;

  -- A separate run references the predecessor as its source. This NO ACTION FK
  -- must cause promotion to reject before changing any canonical data.
  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, tracking_location, category, run_kind, source_run_id
  ) values (
    v_project, 'chatgpt', 'running', 0, 0, now(), 'MY', null, 'full', v_old_run
  ) returning id into v_child_run;

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0, now(), 'MY', 'Skin', 'topic'
  ) returning id into v_new_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'chatgpt', now(), 'Source FK prompt',
    '{"generation":"candidate"}'::jsonb, 'Candidate response',
    'completed', v_new_run, 'MY'
  ) returning id into v_new_response;

  perform public.stage_tracking_candidate_rows(v_new_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', v_new_run,
      'visibility_score', 0, 'visibility_rank', null, 'rank_population_count', null,
      'rank_population_status', 'unverified', 'citation_count', 0, 'presence_count', 0, 'response_count', 1
    )));
  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_new_run;

  begin
    v_result := public.promote_tracking_run_candidate(v_new_run, null);
    raise exception 'expected source_run_id dependency rejection did not occur';
  exception when others then
    v_error := sqlerrm;
  end;

  if v_error not like '%predecessor_is_referenced_as_source_run%' then
    raise exception 'unexpected source_run_id rejection: %', v_error;
  end if;

  if not exists (
    select 1 from public.tracking_runs
    where id = v_old_run and published_at is not null and superseded_at is null
  ) or not exists (
    select 1 from public.ai_responses where id = v_old_response and run_id = v_old_run
  ) or not exists (
    select 1 from public.visibility_daily
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Skin' and llm_provider = 'chatgpt'
      and tracking_location = 'MY' and run_id = v_old_run
  ) then
    raise exception 'source_run_id rejection did not preserve the predecessor dataset';
  end if;

  if not exists (
    select 1 from public.tracking_runs
    where id = v_new_run and status = 'completed' and published_at is null
  ) or not exists (
    select 1 from public.ai_responses where id = v_new_response and run_id = v_new_run
  ) or not exists (
    select 1 from public.tracking_run_candidate_rows where run_id = v_new_run
  ) then
    raise exception 'source_run_id rejection did not preserve the unpublished candidate';
  end if;

  if exists (
    select 1 from public.tracking_run_replacements
    where project_id = v_project and replacement_run_id = v_new_run
  ) then
    raise exception 'source_run_id rejection left replacement audit rows behind';
  end if;

  if not exists (
    select 1 from public.tracking_runs where id = v_child_run and source_run_id = v_old_run
  ) then
    raise exception 'source-run provenance row was unexpectedly changed';
  end if;
end
$$;

rollback;
select 'replacement rerun source-run FK behavioural tests passed' as result;
