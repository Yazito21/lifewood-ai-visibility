-- Behavioural test: a forced failure after predecessor deletion has begun rolls back
-- the entire promotion transaction and preserves the currently published dataset.
-- Runs only in the disposable local Supabase database in GitHub Actions.

begin;
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);

create or replace function public.test_fail_candidate_visibility_insert()
returns trigger
language plpgsql
as $$
begin
  if new.run_id::text = current_setting('test.fail_promotion_run_id', true) then
    raise exception 'intentional_mid_promotion_failure';
  end if;
  return new;
end;
$$;

create trigger test_fail_candidate_visibility_insert
before insert on public.visibility_daily
for each row execute function public.test_fail_candidate_visibility_insert();

do $$
declare
  v_project uuid;
  v_prompt uuid;
  v_old_run uuid;
  v_new_run uuid;
  v_old_response uuid;
  v_new_response uuid;
  v_result jsonb;
  v_error text;
  v_metric_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_audit_before integer;
  v_audit_after integer;
begin
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Rollback Brand', array['Skin'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Synthetic rollback prompt', 'Skin', 'English', true)
  returning id into v_prompt;

  -- Establish the currently published dataset.
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
    v_project, v_prompt, 'chatgpt', now(), 'Synthetic rollback prompt',
    '{"generation":"original"}'::jsonb, 'Original published response',
    'completed', v_old_run, 'MY'
  ) returning id into v_old_response;

  perform public.stage_tracking_candidate_rows(
    v_old_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'run_id', v_old_run, 'visibility_score', 0,
      'visibility_rank', null, 'rank_population_count', null,
      'rank_population_status', 'unverified', 'citation_count', 0,
      'presence_count', 0, 'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_old_run;

  v_result := public.promote_tracking_run_candidate(v_old_run, null);
  if v_result->>'status' <> 'published' then
    raise exception 'original run did not publish: %', v_result;
  end if;

  select count(*) into v_audit_before
  from public.tracking_run_replacements
  where project_id = v_project and metric_date = v_metric_date;

  -- Prepare a valid replacement candidate. The deliberate trigger failure is
  -- configured only after the candidate has passed all pre-promotion setup.
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
    v_project, v_prompt, 'chatgpt', now(), 'Synthetic rollback prompt',
    '{"generation":"candidate"}'::jsonb, 'Candidate response',
    'completed', v_new_run, 'MY'
  ) returning id into v_new_response;

  perform public.stage_tracking_candidate_rows(
    v_new_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'run_id', v_new_run, 'visibility_score', 0,
      'visibility_rank', null, 'rank_population_count', null,
      'rank_population_status', 'unverified', 'citation_count', 0,
      'presence_count', 0, 'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_new_run;

  perform set_config('test.fail_promotion_run_id', v_new_run::text, true);

  -- PL/pgSQL exception blocks create a subtransaction. All changes made by
  -- the RPC before the trigger raises must be rolled back when caught here.
  begin
    perform public.promote_tracking_run_candidate(v_new_run, null);
    raise exception 'expected forced promotion failure did not occur';
  exception
    when others then
      v_error := sqlerrm;
  end;

  if v_error not like '%intentional_mid_promotion_failure%' then
    raise exception 'unexpected promotion failure: %', v_error;
  end if;

  -- The predecessor run, raw response and published metric must be unchanged.
  if not exists (
    select 1 from public.tracking_runs
    where id = v_old_run and status = 'completed' and published_at is not null
      and superseded_at is null
  ) then
    raise exception 'rollback did not restore predecessor tracking_run';
  end if;

  if not exists (
    select 1 from public.ai_responses
    where id = v_old_response and run_id = v_old_run
      and response_text = 'Original published response'
  ) then
    raise exception 'rollback did not restore predecessor raw response';
  end if;

  if not exists (
    select 1 from public.visibility_daily
    where project_id = v_project and run_id = v_old_run
      and metric_date = v_metric_date and category = 'Skin'
      and llm_provider = 'chatgpt' and tracking_location = 'MY'
      and visibility_score = 0
  ) then
    raise exception 'rollback did not restore predecessor canonical metric';
  end if;

  if exists (
    select 1 from public.tracking_runs
    where id = v_new_run and published_at is not null
  ) then
    raise exception 'failed candidate was incorrectly published';
  end if;

  if not exists (
    select 1 from public.tracking_runs
    where id = v_new_run and status = 'completed' and published_at is null
  ) then
    raise exception 'failed candidate should remain completed and unpublished';
  end if;

  if not exists (
    select 1 from public.ai_responses
    where id = v_new_response and run_id = v_new_run
  ) then
    raise exception 'candidate raw response was unexpectedly removed';
  end if;

  if not exists (
    select 1 from public.tracking_run_candidate_rows
    where run_id = v_new_run and table_key = 'visibility_daily'
  ) then
    raise exception 'candidate staging data was unexpectedly cleared';
  end if;

  select count(*) into v_audit_after
  from public.tracking_run_replacements
  where project_id = v_project and metric_date = v_metric_date;

  if v_audit_after <> v_audit_before then
    raise exception 'rollback left replacement audit rows behind';
  end if;

  if exists (
    select 1 from public.visibility_daily
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Skin' and llm_provider = 'chatgpt'
      and tracking_location = 'MY' and run_id = v_new_run
  ) then
    raise exception 'rollback left candidate canonical metrics behind';
  end if;
end
$$;

drop trigger test_fail_candidate_visibility_insert on public.visibility_daily;
drop function public.test_fail_candidate_visibility_insert();

rollback;
select 'replacement rerun rollback behavioural tests passed' as result;
