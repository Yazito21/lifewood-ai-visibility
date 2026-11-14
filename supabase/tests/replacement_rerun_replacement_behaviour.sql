-- Behavioural test: a second candidate atomically replaces the exact published scope.
-- Runs only in the disposable local Supabase database in GitHub Actions.

begin;
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  v_project uuid;
  v_prompt uuid;
  v_old_run uuid;
  v_new_run uuid;
  v_old_response uuid;
  v_new_response uuid;
  v_result jsonb;
  v_metric_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_old_score numeric := 0.11;
  v_new_score numeric := 0.77;
begin
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Replacement Brand', array['Skin'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Synthetic replacement prompt', 'Skin', 'English', true)
  returning id into v_prompt;

  -- Publish the original run first.
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
    v_project, v_prompt, 'chatgpt', now(), 'Synthetic replacement prompt',
    '{"generation":"old"}'::jsonb, 'Synthetic original response', 'completed', v_old_run, 'MY'
  ) returning id into v_old_response;

  perform public.stage_tracking_candidate_rows(
    v_old_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'run_id', v_old_run, 'visibility_score', v_old_score, 'visibility_rank', null,
      'rank_population_count', null, 'rank_population_status', 'unverified',
      'citation_count', 0, 'presence_count', 0, 'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_old_run;

  v_result := public.promote_tracking_run_candidate(v_old_run, null);
  if v_result->>'status' <> 'published' then
    raise exception 'original run did not publish: %', v_result;
  end if;

  if not exists (
    select 1 from public.visibility_daily
    where project_id = v_project and run_id = v_old_run
      and metric_date = v_metric_date and category = 'Skin'
      and llm_provider = 'chatgpt' and tracking_location = 'MY'
      and visibility_score = v_old_score
  ) then
    raise exception 'original canonical visibility row missing before replacement';
  end if;

  -- Prepare a second completed candidate for the identical project/date/category/provider/location.
  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'topic'
  ) returning id into v_new_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'chatgpt', now(), 'Synthetic replacement prompt',
    '{"generation":"new"}'::jsonb, 'Synthetic replacement response', 'completed', v_new_run, 'MY'
  ) returning id into v_new_response;

  perform public.stage_tracking_candidate_rows(
    v_new_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'run_id', v_new_run, 'visibility_score', v_new_score, 'visibility_rank', null,
      'rank_population_count', null, 'rank_population_status', 'unverified',
      'citation_count', 0, 'presence_count', 0, 'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_new_run;

  v_result := public.promote_tracking_run_candidate(v_new_run, null);
  if v_result->>'status' <> 'published' then
    raise exception 'replacement run did not publish: %', v_result;
  end if;

  if not exists (
    select 1 from public.tracking_runs
    where id = v_new_run and status = 'completed' and published_at is not null
  ) then
    raise exception 'replacement candidate was not published';
  end if;

  if exists (select 1 from public.tracking_runs where id = v_old_run) then
    raise exception 'predecessor tracking_run was not physically removed';
  end if;

  if exists (select 1 from public.ai_responses where id = v_old_response) then
    raise exception 'predecessor raw response was not removed';
  end if;

  if not exists (select 1 from public.ai_responses where id = v_new_response and run_id = v_new_run) then
    raise exception 'replacement raw response is missing';
  end if;

  if not exists (
    select 1 from public.visibility_daily
    where project_id = v_project and run_id = v_new_run
      and metric_date = v_metric_date and category = 'Skin'
      and llm_provider = 'chatgpt' and tracking_location = 'MY'
      and visibility_score = v_new_score
  ) then
    raise exception 'replacement canonical visibility row missing';
  end if;

  if exists (
    select 1 from public.visibility_daily
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Skin' and llm_provider = 'chatgpt'
      and tracking_location = 'MY' and run_id is distinct from v_new_run
  ) then
    raise exception 'stale canonical visibility row remains in replaced scope';
  end if;

  if not exists (
    select 1 from public.tracking_run_replacements
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Skin' and provider = 'chatgpt'
      and tracking_location = 'MY'
      and replacement_run_id = v_new_run
      and replaced_run_id = v_old_run
      and replaced_run_snapshot->>'id' = v_old_run::text
      and deleted_row_counts->>'raw_responses' = '1'
  ) then
    raise exception 'durable replacement audit row or predecessor snapshot missing';
  end if;

  if exists (
    select 1 from public.tracking_run_candidate_rows where run_id = v_new_run
  ) then
    raise exception 'replacement staging rows were not cleared';
  end if;
end
$$;

rollback;
select 'replacement rerun replacement behavioural tests passed' as result;
