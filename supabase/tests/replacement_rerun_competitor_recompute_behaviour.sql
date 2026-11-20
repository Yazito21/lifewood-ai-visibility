-- End-to-end competitor recomputation fixture.
-- Covers imported evidence semantics, replacement-published run selection,
-- competitor observation archiving, citation reconstruction and legacy source-run slices.
-- Runs only in the disposable local Supabase database in GitHub Actions.

begin;
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);

do $competitor_recompute_behaviour$
declare
  v_project uuid;
  v_tracked_brand uuid;
  v_competitor uuid;
  v_retired_competitor uuid;
  v_prompt uuid;
  v_prompt_2 uuid;

  v_import_run uuid;
  v_import_response_1 uuid;
  v_import_response_2 uuid;

  v_old_run uuid;
  v_old_response uuid;
  v_new_run uuid;
  v_new_response uuid;

  v_legacy_run uuid;
  v_legacy_response uuid;
  v_legacy_slice uuid;

  v_result jsonb;
  v_job_id uuid;
  v_retry_job_id uuid;
  v_job_status text;
  v_job_error text;
  v_retry_summary jsonb;
  v_worker_count integer;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_import_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date - 1;
  v_legacy_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date - 2;
  v_import_ts timestamptz;
  v_replace_ts timestamptz;
  v_legacy_ts timestamptz;
begin
  v_import_ts := (v_import_date::text || ' 12:00:00+08')::timestamptz;
  v_replace_ts := (v_today::text || ' 12:00:00+08')::timestamptz;
  v_legacy_ts := (v_legacy_date::text || ' 12:00:00+08')::timestamptz;

  insert into public.projects (brand_name, brand_terms, brand_domains, categories, tracking_market, tracking_locations)
  values ('Synthetic Recompute Brand', array['Acme Clinic'], array['acme.example'], array['Skin'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.brand_registry (
    project_id, canonical_name, normalized_key, aliases, primary_website, is_tracked_brand, is_active
  ) values (
    v_project, 'Acme Clinic', 'acme-clinic', array['Acme'], 'acme.example', true, true
  ) returning id into v_tracked_brand;

  insert into public.brand_registry (
    project_id, canonical_name, normalized_key, aliases, primary_website, is_tracked_brand, is_active
  ) values (
    v_project, 'Beta Clinic', 'beta-clinic', array['Beta'], 'beta.example', false, true
  ) returning id into v_competitor;

  insert into public.brand_registry (
    project_id, canonical_name, normalized_key, aliases, primary_website, is_tracked_brand, is_active
  ) values (
    v_project, 'Retired Clinic', 'retired-clinic', array['Retired'], 'retired.example', false, true
  ) returning id into v_retired_competitor;

  insert into public.category_brand_assignments (
    project_id, category, brand_id, role, aliases, websites, include_in_metrics
  ) values (
    v_project, 'Skin', v_competitor, 'competitor', array['Beta'], array['beta.example'], true
  );

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Which clinics are recommended for skin treatments?', 'Skin', 'English', true)
  returning id into v_prompt;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 2, 'Which providers offer skin treatment advice?', 'Skin', 'English', true)
  returning id into v_prompt_2;

  -- Imported Gemini data: the tracked brand is present according to stored
  -- Profound evidence even though its name is absent from the response text.
  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts, failed_prompts,
    started_at, completed_at, tracking_location, category, run_kind, data_source, import_batch
  ) values (
    v_project, 'gemini', 'completed', 2, 2, 0,
    v_import_ts, v_import_ts, 'MY', 'Skin', 'category', 'profound_import', 'synthetic-import'
  ) returning id into v_import_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot, raw_response,
    response_text, response_status, run_id, tracking_location, data_source
  ) values (
    v_project, v_prompt, 'gemini', v_import_ts, 'Imported prompt 1',
    '{"output":[{"content":[{"annotations":[{"type":"url_citation","url":"https://beta.example/skin-guide"}]}]}]}'::jsonb,
    'Beta Clinic is recommended for skin treatment.', 'completed', v_import_run, 'MY', 'profound_import'
  ) returning id into v_import_response_1;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot, raw_response,
    response_text, response_status, run_id, tracking_location, data_source
  ) values (
    v_project, v_prompt_2, 'gemini', v_import_ts + interval '1 minute', 'Imported prompt 2',
    '{"output":[{"content":[{"annotations":[{"type":"url_citation","url":"https://beta.example/skin-guide"}]}]}]}'::jsonb,
    'Beta Clinic is another option.', 'completed', v_import_run, 'MY', 'profound_import'
  ) returning id into v_import_response_2;

  insert into public.response_brand_evidence (
    project_id, response_id, brand_id, category, match_source, matched_value,
    evidence_text, first_position, occurrence_count, confidence
  ) values (
    v_project, v_import_response_1, v_tracked_brand, 'Skin', 'response_text', 'Acme Clinic',
    'Imported source marked the tracked brand as mentioned.', 0, 1, 'verified'
  );

  insert into public.visibility_daily (
    project_id, metric_date, category, llm_provider, tracking_location, run_id,
    visibility_score, citation_count, presence_count, response_count, rank_population_status
  ) values (
    v_project, v_import_date, 'Skin', 'gemini', 'MY', v_import_run, 50, 0, 1, 2, 'unverified'
  );

  update public.tracking_runs set published_at = v_import_ts where id = v_import_run;

  -- Replacement pair for Perplexity on today's date. The publication trigger
  -- supersedes the predecessor when the replacement is published.
  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts, failed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'perplexity', 'completed', 1, 1, 0,
    v_replace_ts - interval '10 minutes', v_replace_ts - interval '10 minutes',
    'MY', 'Skin', 'category'
  ) returning id into v_old_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot, raw_response,
    response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'perplexity', v_replace_ts - interval '10 minutes', 'Predecessor prompt',
    '{"output":[{"content":[{"annotations":[{"type":"url_citation","url":"https://retired.example/old"}]}]}]}'::jsonb,
    'Retired Clinic was recommended.', 'completed', v_old_run, 'MY'
  ) returning id into v_old_response;

  insert into public.visibility_daily (
    project_id, metric_date, category, llm_provider, tracking_location, run_id,
    visibility_score, citation_count, presence_count, response_count, rank_population_status
  ) values (
    v_project, v_today, 'Skin', 'perplexity', 'MY', v_old_run, 0, 0, 0, 1, 'unverified'
  );

  update public.tracking_runs set published_at = v_replace_ts - interval '10 minutes' where id = v_old_run;

  insert into public.category_brand_observations (
    project_id, brand_id, category, metric_date, tracking_location, llm_provider,
    presence_count, response_count, mention_count, citation_count, average_position, run_id
  ) values (
    v_project, v_retired_competitor, 'Skin', v_today, 'MY', 'perplexity',
    1, 1, 1, 1, 1, v_old_run
  );

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts, failed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'perplexity', 'completed', 1, 1, 0,
    v_replace_ts, v_replace_ts, 'MY', 'Skin', 'category'
  ) returning id into v_new_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot, raw_response,
    response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'perplexity', v_replace_ts, 'Replacement prompt',
    '{"output":[{"content":[{"annotations":[{"type":"url_citation","url":"https://beta.example/replacement-guide"}]}]}]}'::jsonb,
    'Acme Clinic and Beta Clinic are both recommended.', 'completed', v_new_run, 'MY'
  ) returning id into v_new_response;

  insert into public.response_brand_evidence (
    project_id, response_id, brand_id, category, match_source, matched_value,
    evidence_text, first_position, occurrence_count, confidence
  ) values (
    v_project, v_new_response, v_tracked_brand, 'Skin', 'response_text', 'Acme Clinic',
    'Acme Clinic', 0, 1, 'verified'
  );

  insert into public.visibility_daily (
    project_id, metric_date, category, llm_provider, tracking_location, run_id,
    visibility_score, citation_count, presence_count, response_count, rank_population_status
  ) values (
    v_project, v_today, 'Skin', 'perplexity', 'MY', v_new_run, 100, 0, 1, 1, 'unverified'
  )
  on conflict (project_id, metric_date, category, llm_provider, tracking_location)
  do update set run_id = excluded.run_id, visibility_score = excluded.visibility_score,
                citation_count = excluded.citation_count, presence_count = excluded.presence_count,
                response_count = excluded.response_count, rank_population_status = excluded.rank_population_status;

  update public.tracking_runs set published_at = v_replace_ts where id = v_new_run;

  -- Legacy all-category ChatGPT run. Its stored Overall-provider category
  -- score is reproducible from raw response evidence, so recompute should
  -- publish a synthetic category slice linked back to this source run.
  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts, failed_prompts,
    started_at, completed_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'completed', 1, 1, 0,
    v_legacy_ts, v_legacy_ts, 'MY', null, 'full'
  ) returning id into v_legacy_run;

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot, raw_response,
    response_text, response_status, run_id, tracking_location
  ) values (
    v_project, v_prompt, 'chatgpt', v_legacy_ts, 'Legacy full-run prompt',
    '{"output":[{"content":[{"annotations":[{"type":"url_citation","url":"https://beta.example/legacy-guide"}]}]}]}'::jsonb,
    'Acme Clinic and Beta Clinic are recommended.', 'completed', v_legacy_run, 'MY'
  ) returning id into v_legacy_response;

  insert into public.response_brand_evidence (
    project_id, response_id, brand_id, category, match_source, matched_value,
    evidence_text, first_position, occurrence_count, confidence
  ) values (
    v_project, v_legacy_response, v_tracked_brand, 'Skin', 'response_text', 'Acme Clinic',
    'Acme Clinic', 0, 1, 'verified'
  );

  insert into public.visibility_daily (
    project_id, metric_date, category, llm_provider, tracking_location, run_id,
    visibility_score, citation_count, presence_count, response_count, rank_population_status
  ) values (
    v_project, v_legacy_date, 'Skin', 'Overall', 'MY', v_legacy_run, 100, 0, 1, 1, 'unverified'
  );

  v_result := public.recompute_competitor_metrics(v_project, v_legacy_date, v_today);

  if v_result->>'status' <> 'completed' then
    raise exception 'competitor recomputation did not complete: %', v_result;
  end if;

  if coalesce((v_result->>'slices_backfilled')::integer, 0) <> 1 then
    raise exception 'expected one verifiable legacy category slice, got %', v_result;
  end if;

  if jsonb_array_length(coalesce(v_result->'units_blocked', '[]'::jsonb)) <> 0 then
    raise exception 'one or more synthetic units failed canonical finalization: %', v_result->'units_blocked';
  end if;

  select id into v_legacy_slice
  from public.tracking_runs
  where project_id = v_project and source_run_id = v_legacy_run
    and category = 'Skin' and provider = 'chatgpt'
    and published_at is not null and superseded_at is null;

  if v_legacy_slice is null then
    raise exception 'legacy full run was not republished as a category slice with source lineage';
  end if;

  if not exists (
    select 1 from public.visibility_daily
    where project_id = v_project and metric_date = v_legacy_date and category = 'Skin'
      and llm_provider = 'Overall' and tracking_location = 'MY' and run_id = v_legacy_slice
  ) then
    raise exception 'legacy category metric row was not relinked to its synthetic source-run slice';
  end if;

  if not exists (
    select 1 from public.category_brand_observations
    where project_id = v_project and brand_id = v_competitor and category = 'Skin'
      and metric_date = v_import_date and tracking_location = 'MY' and llm_provider = 'gemini'
      and run_id = v_import_run and presence_count = 2 and response_count = 2 and citation_count = 2
  ) then
    raise exception 'imported Gemini competitor observations were not rebuilt from stored responses';
  end if;

  if not exists (
    select 1 from public.visibility_daily
    where project_id = v_project and metric_date = v_import_date and category = 'Skin'
      and llm_provider = 'gemini' and tracking_location = 'MY'
      and run_id = v_import_run and visibility_score = 50 and presence_count = 1 and response_count = 2
  ) then
    raise exception 'imported tracked-brand presence did not preserve stored evidence semantics';
  end if;

  if not exists (
    select 1 from public.category_brand_observations
    where project_id = v_project and brand_id = v_competitor and category = 'Skin'
      and metric_date = v_today and tracking_location = 'MY' and llm_provider = 'perplexity'
      and run_id = v_new_run and presence_count = 1 and response_count = 1 and citation_count = 1
  ) then
    raise exception 'competitor observations were not rebuilt from the active replacement run';
  end if;

  if exists (
    select 1 from public.category_brand_observations
    where project_id = v_project and brand_id = v_retired_competitor and category = 'Skin'
      and metric_date = v_today and tracking_location = 'MY' and llm_provider = 'perplexity'
  ) then
    raise exception 'observation for a no-longer-assigned competitor remains active';
  end if;

  if not exists (
    select 1 from public.category_brand_observations_archive
    where project_id = v_project and brand_id = v_retired_competitor and category = 'Skin'
      and metric_date = v_today and tracking_location = 'MY' and llm_provider = 'perplexity'
      and run_id = v_old_run and archive_reason = 'competitor set replaced'
  ) then
    raise exception 'removed competitor observation was not archived';
  end if;

  if not exists (
    select 1 from public.citation_occurrences
    where project_id = v_project and response_id = v_import_response_1 and entity_id = v_competitor
      and category = 'Skin' and provider = 'gemini' and tracking_location = 'MY'
      and canonical_domain = 'beta.example'
  ) or not exists (
    select 1 from public.citation_occurrences
    where project_id = v_project and response_id = v_new_response and entity_id = v_competitor
      and category = 'Skin' and provider = 'perplexity' and tracking_location = 'MY'
      and canonical_domain = 'beta.example'
  ) then
    raise exception 'competitor citation occurrences were not reconstructed for imported and replacement runs';
  end if;

  if not exists (
    select 1 from public.response_brand_evidence
    where project_id = v_project and response_id = v_new_response and brand_id = v_competitor
      and category = 'Skin' and match_source = 'response_text'
  ) then
    raise exception 'replacement competitor response evidence was not rebuilt';
  end if;

  if not exists (
    select 1 from public.tracking_runs
    where id = v_old_run and superseded_at is not null
  ) or not exists (
    select 1 from public.tracking_runs
    where id = v_new_run and published_at is not null and superseded_at is null
  ) then
    raise exception 'replacement predecessor/current publication lineage is inconsistent';
  end if;

  -- Exercise the durable recompute queue's failure and explicit retry path.
  -- The injected trigger forces a deterministic worker failure after it starts.
  drop table if exists pg_temp._cm_units, pg_temp._cm_resp, pg_temp._cm_entities,
    pg_temp._cm_hits, pg_temp._cm_cit_entities, pg_temp._cm_tracked_missing, pg_temp._cm_cit;

  execute $ddl$
    create or replace function public.replacement_rerun_test_fail_competitor_observation()
    returns trigger language plpgsql as $function$
    begin
      raise exception 'synthetic competitor recompute queue failure';
    end;
    $function$;
  $ddl$;

  execute 'create trigger replacement_rerun_test_fail_competitor_observation
    before insert or update on public.category_brand_observations
    for each row execute function public.replacement_rerun_test_fail_competitor_observation()';

  delete from public.competitor_recompute_jobs where project_id = v_project;
  insert into public.competitor_recompute_jobs (project_id, status, reason, requested_at)
  values (v_project, 'queued', 'synthetic_failure_test', now() - interval '30 seconds')
  returning id into v_job_id;

  v_worker_count := public.process_competitor_recompute_jobs();
  select status, error_message into v_job_status, v_job_error
  from public.competitor_recompute_jobs where id = v_job_id;

  if v_worker_count <> 1 or v_job_status <> 'failed'
     or v_job_error not like '%synthetic competitor recompute queue failure%' then
    raise exception 'recompute worker did not record the injected failure: count %, status %, error %',
      v_worker_count, v_job_status, v_job_error;
  end if;

  execute 'drop trigger replacement_rerun_test_fail_competitor_observation on public.category_brand_observations';
  execute 'drop function public.replacement_rerun_test_fail_competitor_observation()';

  -- A failed job is retained for audit; explicit re-enqueue creates a new queued job.
  v_retry_job_id := public.enqueue_competitor_recompute(v_project, 'synthetic_manual_retry');
  if v_retry_job_id is null or v_retry_job_id = v_job_id then
    raise exception 'explicit retry did not create a fresh queue job after failure';
  end if;

  update public.competitor_recompute_jobs
  set requested_at = now() - interval '30 seconds'
  where id = v_retry_job_id;

  drop table if exists pg_temp._cm_units, pg_temp._cm_resp, pg_temp._cm_entities,
    pg_temp._cm_hits, pg_temp._cm_cit_entities, pg_temp._cm_tracked_missing, pg_temp._cm_cit;

  v_worker_count := public.process_competitor_recompute_jobs();
  select status, summary into v_job_status, v_retry_summary
  from public.competitor_recompute_jobs where id = v_retry_job_id;

  if v_worker_count <> 1 or v_job_status <> 'completed'
     or v_retry_summary->>'status' <> 'completed' then
    raise exception 'explicit retry did not complete successfully: count %, status %, summary %',
      v_worker_count, v_job_status, v_retry_summary;
  end if;
end
$competitor_recompute_behaviour$;

rollback;
select 'replacement rerun competitor recompute behavioural tests passed' as result;
