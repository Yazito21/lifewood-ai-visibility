-- Behavioural test: first publication with no predecessor.
-- Runs only in the disposable local Supabase database in GitHub Actions.

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
  values ('Synthetic First Publication Brand', array['Skin'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Synthetic first publication prompt', 'Skin', 'English', true)
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
    v_project, v_prompt, 'chatgpt', now(), 'Synthetic first publication prompt',
    '{}'::jsonb, 'Synthetic completed response', 'completed', v_run, 'MY'
  );

  perform public.stage_tracking_candidate_rows(
    v_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project,
      'metric_date', v_metric_date,
      'category', 'Skin',
      'llm_provider', 'chatgpt',
      'tracking_location', 'MY',
      'run_id', v_run,
      'visibility_score', 0,
      'visibility_rank', 1,
      'citation_count', 0,
      'presence_count', 0,
      'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_run;

  v_result := public.promote_tracking_run_candidate(v_run, null);

  if v_result->>'status' <> 'published' then
    raise exception 'expected candidate to publish, got %', v_result;
  end if;

  if not exists (
    select 1 from public.tracking_runs
    where id = v_run and published_at is not null and status = 'completed'
  ) then
    raise exception 'candidate run was not marked published';
  end if;

  if not exists (
    select 1 from public.visibility_daily
    where project_id = v_project and run_id = v_run
      and metric_date = v_metric_date and category = 'Skin'
      and llm_provider = 'chatgpt' and tracking_location = 'MY'
  ) then
    raise exception 'canonical visibility row was not inserted';
  end if;

  if exists (
    select 1 from public.tracking_run_candidate_rows where run_id = v_run
  ) then
    raise exception 'candidate staging rows were not cleared after promotion';
  end if;

  if exists (
    select 1 from public.tracking_run_replacements where replacement_run_id = v_run
  ) then
    raise exception 'first publication unexpectedly created predecessor audit rows';
  end if;
end
$$;

rollback;
select 'replacement rerun first-publication behavioural tests passed' as result;
