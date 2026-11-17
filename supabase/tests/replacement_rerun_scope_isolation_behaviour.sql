-- Behavioural test: promotion is isolated to project/date/category/provider/location.
-- Runs only against the disposable local Supabase database in CI.

begin;
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  v_project uuid;
  v_other_project uuid;
  v_prompt uuid;
  v_run uuid;
  v_candidate uuid;
  v_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_other_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date - 1;
  v_scope record;
  v_result jsonb;
  v_count integer;
begin
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Scope Isolation Brand', array['Skin','Mind'], 'MY', array['MY','SG'])
  returning id into v_project;

  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Other Project Brand', array['Skin'], 'MY', array['MY'])
  returning id into v_other_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Synthetic scope isolation prompt', 'Skin', 'English', true)
  returning id into v_prompt;

  -- Neighbouring published scopes that must survive the Skin/chatgpt/MY replacement.
  for v_scope in
    select * from (values
      ('Mind'::text, 'chatgpt'::text, 'MY'::text, v_date, v_project),
      ('Skin'::text, 'chatgpt'::text, 'MY'::text, v_other_date, v_project),
      ('Skin'::text, 'gemini'::text, 'MY'::text, v_date, v_project),
      ('Skin'::text, 'chatgpt'::text, 'SG'::text, v_date, v_project),
      ('Skin'::text, 'chatgpt'::text, 'MY'::text, v_date, v_other_project)
    ) as scopes(category, provider, location, metric_date, project_id)
  loop
    insert into public.tracking_runs (
      project_id, provider, status, total_prompts, completed_prompts,
      started_at, completed_at, published_at, tracking_location, category, run_kind
    ) values (
      v_scope.project_id, v_scope.provider, 'completed', 1, 1,
      now(), now(), now(), v_scope.location, v_scope.category, 'topic'
    ) returning id into v_run;

    insert into public.visibility_daily (
      project_id, metric_date, category, llm_provider, visibility_score,
      tracking_location, run_id, citation_count, presence_count, response_count,
      rank_population_status
    ) values (
      v_scope.project_id, v_scope.metric_date, v_scope.category, v_scope.provider,
      0.73, v_scope.location, v_run, 7, 1, 1, 'unverified'
    );
  end loop;

  -- Candidate is scoped only to the primary project/date/category/provider/location.
  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'topic'
  ) returning id into v_candidate;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'chatgpt', now(), 'Synthetic scope isolation prompt',
    '{"candidate":true}'::jsonb, 'Synthetic candidate response', 'completed', v_candidate, 'MY'
  );

  perform public.stage_tracking_candidate_rows(
    v_candidate, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'run_id', v_candidate, 'visibility_score', 0.91, 'visibility_rank', null,
      'rank_population_count', null, 'rank_population_status', 'unverified',
      'citation_count', 9, 'presence_count', 1, 'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_candidate;

  v_result := public.promote_tracking_run_candidate(v_candidate, null);
  if v_result->>'status' <> 'published' then
    raise exception 'scope-isolation candidate failed to publish: %', v_result;
  end if;

  -- Every neighbouring scope must retain its original published run and metric.
  for v_scope in
    select * from (values
      ('Mind'::text, 'chatgpt'::text, 'MY'::text, v_date, v_project),
      ('Skin'::text, 'chatgpt'::text, 'MY'::text, v_other_date, v_project),
      ('Skin'::text, 'gemini'::text, 'MY'::text, v_date, v_project),
      ('Skin'::text, 'chatgpt'::text, 'SG'::text, v_date, v_project),
      ('Skin'::text, 'chatgpt'::text, 'MY'::text, v_date, v_other_project)
    ) as scopes(category, provider, location, metric_date, project_id)
  loop
    select count(*) into v_count
    from public.visibility_daily vd
    join public.tracking_runs tr on tr.id = vd.run_id
    where vd.project_id = v_scope.project_id
      and vd.metric_date = v_scope.metric_date
      and vd.category = v_scope.category
      and vd.llm_provider = v_scope.provider
      and vd.tracking_location = v_scope.location
      and vd.visibility_score = 0.73
      and tr.status = 'completed'
      and tr.published_at is not null;

    if v_count <> 1 then
      raise exception 'neighbour scope was altered or lost: project %, date %, category %, provider %, location % (rows=%)',
        v_scope.project_id, v_scope.metric_date, v_scope.category,
        v_scope.provider, v_scope.location, v_count;
    end if;
  end loop;

  if not exists (
    select 1 from public.visibility_daily
    where project_id = v_project and metric_date = v_date
      and category = 'Skin' and llm_provider = 'chatgpt'
      and tracking_location = 'MY' and run_id = v_candidate
      and visibility_score = 0.91
  ) then
    raise exception 'target replacement metric missing';
  end if;

  if exists (
    select 1 from public.visibility_daily
    where project_id = v_project and metric_date = v_date
      and category = 'Skin' and llm_provider = 'chatgpt'
      and tracking_location = 'MY' and run_id <> v_candidate
  ) then
    raise exception 'stale target-scope metric remains after replacement';
  end if;
end
$$;

rollback;
select 'replacement rerun scope-isolation behavioural tests passed' as result;
