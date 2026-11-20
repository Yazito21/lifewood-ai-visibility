-- Behavioural tests: Overall is rebuilt from surviving category runs,
-- and invalidated when the configured category set is incomplete.
-- Runs only in the disposable local Supabase database in GitHub Actions.

begin;
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  v_project uuid;
  v_prompt uuid;
  v_candidate uuid;
  v_response uuid;
  v_result jsonb;
  v_metric_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_overall_run uuid;
begin
  -- Case 1: a single configured category should produce a fresh Overall snapshot.
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Overall Single Category', array['Skin'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Overall rebuild prompt', 'Skin', 'English', true)
  returning id into v_prompt;

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'category'
  ) returning id into v_candidate;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'chatgpt', now(), 'Overall rebuild prompt',
    '{"case":"single-category"}'::jsonb, 'Synthetic completed response',
    'completed', v_candidate, 'MY'
  ) returning id into v_response;

  perform public.stage_tracking_candidate_rows(
    v_candidate, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'run_id', v_candidate, 'visibility_score', 0, 'visibility_rank', null,
      'rank_population_count', null, 'rank_population_status', 'unverified',
      'citation_count', 0, 'presence_count', 0, 'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_candidate;

  v_result := public.promote_tracking_run_candidate(v_candidate, null);
  if v_result->>'status' <> 'published' then
    raise exception 'single-category candidate did not publish: %', v_result;
  end if;

  select run_id into v_overall_run
  from public.visibility_daily
  where project_id = v_project and metric_date = v_metric_date
    and category = 'Overall' and llm_provider = 'Overall'
    and tracking_location = 'MY';

  if v_overall_run is null
     or not exists (
       select 1 from public.tracking_runs
       where id = v_overall_run and run_kind = 'overall_aggregate'
         and published_at is not null and superseded_at is null
     )
     or not exists (
       select 1 from public.visibility_daily
       where project_id = v_project and metric_date = v_metric_date
         and category = 'Overall' and llm_provider = 'Overall'
         and tracking_location = 'MY' and run_id = v_overall_run
         and source_run_ids = array[v_candidate]::uuid[]
     ) then
    raise exception 'Overall snapshot was not rebuilt from the replacement category run';
  end if;
end
$$;

do $$
declare
  v_project uuid;
  v_prompt_skin uuid;
  v_prompt_mind uuid;
  v_skin_candidate uuid;
  v_mind_run uuid;
  v_stale_overall uuid;
  v_result jsonb;
  v_metric_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_overall_run uuid;
begin
  -- Case 2: when every configured category has a published run, Overall must
  -- include the replacement Skin run and the latest surviving Mind run.
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Overall Complete Categories', array['Skin','Mind'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Skin prompt', 'Skin', 'English', true)
  returning id into v_prompt_skin;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 2, 'Mind prompt', 'Mind', 'English', true)
  returning id into v_prompt_mind;

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, published_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'completed', 1, 1,
    now(), now(), now(), 'MY', 'Mind', 'category'
  ) returning id into v_mind_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt_mind, 'chatgpt', now(), 'Mind prompt',
    '{"case":"mind-sibling"}'::jsonb, 'Mind sibling response',
    'completed', v_mind_run, 'MY'
  );

  insert into public.visibility_daily (
    project_id, metric_date, category, llm_provider, tracking_location, run_id,
    visibility_score, citation_count, presence_count, response_count,
    rank_population_status, source_run_ids
  ) values (
    v_project, v_metric_date, 'Mind', 'chatgpt', 'MY', v_mind_run,
    0, 0, 0, 1, 'unverified', array[v_mind_run]::uuid[]
  );

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, published_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'completed', 1, 1,
    now(), now(), now(), 'MY', null, 'overall_aggregate'
  ) returning id into v_stale_overall;

  insert into public.visibility_daily (
    project_id, metric_date, category, llm_provider, tracking_location, run_id,
    visibility_score, citation_count, presence_count, response_count,
    rank_population_status, source_run_ids
  ) values
    (v_project, v_metric_date, 'Overall', 'Overall', 'MY', v_stale_overall, 0, 0, 0, 1, 'unverified', array[v_mind_run]::uuid[]),
    (v_project, v_metric_date, 'Overall', 'chatgpt', 'MY', v_stale_overall, 0, 0, 0, 1, 'unverified', array[v_mind_run]::uuid[]);

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'category'
  ) returning id into v_skin_candidate;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt_skin, 'chatgpt', now(), 'Skin prompt',
    '{"case":"skin-replacement"}'::jsonb, 'Skin replacement response',
    'completed', v_skin_candidate, 'MY'
  );

  perform public.stage_tracking_candidate_rows(
    v_skin_candidate, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'run_id', v_skin_candidate, 'visibility_score', 0, 'visibility_rank', null,
      'rank_population_count', null, 'rank_population_status', 'unverified',
      'citation_count', 0, 'presence_count', 0, 'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_skin_candidate;

  v_result := public.promote_tracking_run_candidate(v_skin_candidate, null);
  if v_result->>'status' <> 'published' then
    raise exception 'complete-category replacement did not publish: %', v_result;
  end if;

  select run_id into v_overall_run
  from public.visibility_daily
  where project_id = v_project and metric_date = v_metric_date
    and category = 'Overall' and llm_provider = 'Overall'
    and tracking_location = 'MY';

  if v_overall_run is null or v_overall_run = v_stale_overall
     or not exists (
       select 1 from public.visibility_daily
       where project_id = v_project and metric_date = v_metric_date
         and category = 'Overall' and llm_provider = 'Overall'
         and tracking_location = 'MY' and run_id = v_overall_run
         and source_run_ids @> array[v_skin_candidate, v_mind_run]::uuid[]
         and cardinality(source_run_ids) = 2
     ) then
    raise exception 'Overall aggregate did not include the replacement and latest sibling category';
  end if;

  if not exists (
    select 1 from public.tracking_runs
    where id = v_stale_overall and superseded_at is not null
  ) then
    raise exception 'previous Overall aggregate was not superseded';
  end if;
end
$$;

do $$
declare
  v_project uuid;
  v_prompt uuid;
  v_candidate uuid;
  v_stale_overall uuid;
  v_result jsonb;
  v_metric_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  -- Case 3: if a configured category is missing, stale Overall metrics must be
  -- invalidated instead of continuing to include an obsolete category snapshot.
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Overall Missing Category', array['Skin','Mind'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Skin prompt', 'Skin', 'English', true)
  returning id into v_prompt;

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, published_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'completed', 1, 1,
    now(), now(), now(), 'MY', null, 'overall_aggregate'
  ) returning id into v_stale_overall;

  insert into public.visibility_daily (
    project_id, metric_date, category, llm_provider, tracking_location, run_id,
    visibility_score, citation_count, presence_count, response_count,
    rank_population_status, source_run_ids
  ) values
    (v_project, v_metric_date, 'Overall', 'Overall', 'MY', v_stale_overall, 25, 0, 1, 4, 'unverified', array[]::uuid[]),
    (v_project, v_metric_date, 'Overall', 'chatgpt', 'MY', v_stale_overall, 25, 0, 1, 4, 'unverified', array[]::uuid[]);

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'category'
  ) returning id into v_candidate;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'chatgpt', now(), 'Skin prompt',
    '{"case":"missing-category"}'::jsonb, 'Skin response',
    'completed', v_candidate, 'MY'
  );

  perform public.stage_tracking_candidate_rows(
    v_candidate, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'run_id', v_candidate, 'visibility_score', 0, 'visibility_rank', null,
      'rank_population_count', null, 'rank_population_status', 'unverified',
      'citation_count', 0, 'presence_count', 0, 'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_candidate;

  v_result := public.promote_tracking_run_candidate(v_candidate, null);
  if v_result->>'status' <> 'published' then
    raise exception 'missing-category candidate did not publish: %', v_result;
  end if;

  if exists (
    select 1 from public.visibility_daily
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Overall' and tracking_location = 'MY'
  ) then
    raise exception 'stale Overall visibility rows remain despite incomplete category coverage';
  end if;

  if not exists (
    select 1 from public.tracking_runs
    where id = v_stale_overall and superseded_at is not null
  ) then
    raise exception 'stale Overall aggregate run was not marked superseded';
  end if;
end
$$;


do $multi_provider$
declare
  v_project uuid;
  v_prompt uuid;
  v_brand uuid;
  v_gemini_run uuid;
  v_chatgpt_run uuid;
  v_response uuid;
  v_result jsonb;
  v_overall_run uuid;
  v_metric_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  -- A ChatGPT replacement must not overwrite the shared Overall pool when a
  -- Gemini run also exists for the same project/date/category/location.
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Multi Provider Overall', array['Skin'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Multi-provider prompt', 'Skin', 'English', true)
  returning id into v_prompt;

  insert into public.brand_registry (
    project_id, canonical_name, normalized_key, is_tracked_brand, is_active
  ) values (
    v_project, 'Synthetic Multi Provider Overall', 'syntheticmultiprovideroverall', true, true
  ) returning id into v_brand;

  insert into public.category_brand_assignments (
    project_id, category, brand_id, role, include_in_metrics
  ) values (v_project, 'Skin', v_brand, 'tracked_brand', true);

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, published_at, tracking_location, category, run_kind
  ) values (
    v_project, 'gemini', 'completed', 1, 1,
    now(), now(), now(), 'MY', 'Skin', 'category'
  ) returning id into v_gemini_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'gemini', now(), 'Multi-provider prompt',
    '{"provider":"gemini"}'::jsonb, 'Synthetic tracked brand mentioned by Gemini',
    'completed', v_gemini_run, 'MY'
  ) returning id into v_response;

  insert into public.response_brand_evidence (
    project_id, response_id, brand_id, category, match_source, matched_value,
    evidence_text, first_position, occurrence_count, confidence
  ) values (
    v_project, v_response, v_brand, 'Skin', 'response_text',
    'Synthetic Multi Provider Overall', 'Synthetic tracked brand mentioned by Gemini',
    1, 1, 'deterministic'
  );

  insert into public.visibility_daily (
    project_id, metric_date, category, llm_provider, tracking_location, run_id,
    visibility_score, citation_count, presence_count, response_count,
    rank_population_status, source_run_ids, metric_version
  ) values (
    v_project, v_metric_date, 'Skin', 'gemini', 'MY', v_gemini_run,
    100, 4, 1, 1, 'unverified', array[v_gemini_run]::uuid[], 'v2'
  );

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'running', 1, 0,
    now(), null, 'MY', 'Skin', 'category'
  ) returning id into v_chatgpt_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'chatgpt', now(), 'Multi-provider prompt',
    '{"provider":"chatgpt"}'::jsonb, 'No tracked brand mention in ChatGPT response',
    'completed', v_chatgpt_run, 'MY'
  );

  perform public.stage_tracking_candidate_rows(
    v_chatgpt_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'run_id', v_chatgpt_run, 'visibility_score', 0, 'visibility_rank', null,
      'rank_population_count', null, 'rank_population_status', 'unverified',
      'citation_count', 2, 'presence_count', 0, 'response_count', 1
    ))
  );

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_chatgpt_run;

  v_result := public.promote_tracking_run_candidate(v_chatgpt_run, null);
  if v_result->>'status' <> 'published' then
    raise exception 'multi-provider replacement did not publish: %', v_result;
  end if;

  select run_id into v_overall_run
  from public.visibility_daily
  where project_id = v_project and metric_date = v_metric_date
    and category = 'Overall' and llm_provider = 'Overall'
    and tracking_location = 'MY';

  if v_overall_run is null
     or not exists (
       select 1 from public.tracking_runs
       where id = v_overall_run and provider = 'Overall'
         and run_kind = 'overall_aggregate' and published_at is not null
         and superseded_at is null
     )
     or not exists (
       select 1 from public.visibility_daily
       where project_id = v_project and metric_date = v_metric_date
         and category = 'Overall' and llm_provider = 'Overall'
         and tracking_location = 'MY' and run_id = v_overall_run
         and visibility_score = 50 and citation_count = 6
         and source_run_ids @> array[v_chatgpt_run, v_gemini_run]::uuid[]
         and cardinality(source_run_ids) = 2
     ) then
    raise exception 'shared Overall pool was overwritten by one provider instead of pooling ChatGPT and Gemini';
  end if;
end
$multi_provider$;

rollback;
select 'replacement rerun Overall aggregation behavioural tests passed' as result;
