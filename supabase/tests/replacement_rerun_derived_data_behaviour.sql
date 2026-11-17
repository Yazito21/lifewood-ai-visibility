-- Behavioural test: replacement removes predecessor raw/derived rows,
-- inserts the candidate's staged derived rows, and preserves separate competitor data.
-- Runs only in the disposable local Supabase database in GitHub Actions.

begin;
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  v_project uuid;
  v_prompt uuid;
  v_brand uuid;
  v_competitor_brand uuid;
  v_direct_competitor uuid;
  v_old_run uuid;
  v_new_run uuid;
  v_old_response uuid;
  v_new_response uuid;
  v_result jsonb;
  v_metric_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_old_url text := 'https://old-source.example/article';
  v_new_url text := 'https://new-source.example/article';
begin
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Synthetic Derived Replacement Brand', array['Skin'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.prompts (project_id, prompt_number, prompt, category, language, active)
  values (v_project, 1, 'Derived replacement prompt', 'Skin', 'English', true)
  returning id into v_prompt;

  insert into public.brand_registry (
    project_id, canonical_name, normalized_key, is_tracked_brand, is_active
  ) values (
    v_project, 'Synthetic Derived Replacement Brand', 'syntheticderivedreplacementbrand', true, true
  ) returning id into v_brand;

  insert into public.category_brand_assignments (
    project_id, category, brand_id, role, include_in_metrics
  ) values (v_project, 'Skin', v_brand, 'tracked_brand', true);

  insert into public.brand_registry (
    project_id, canonical_name, normalized_key, is_tracked_brand, is_active
  ) values (
    v_project, 'Synthetic Competitor One', 'syntheticcompetitorone', false, true
  ) returning id into v_competitor_brand;

  insert into public.category_brand_assignments (
    project_id, category, brand_id, role, include_in_metrics
  ) values (v_project, 'Skin', v_competitor_brand, 'competitor', true);

  -- Sentinel rows prove that this workflow leaves the legacy competitor summary
  -- and the separate direct-competitor registry/observations untouched.
  insert into public.competitors (
    project_id, metric_date, category, llm_provider, brand_name, website,
    visibility_score, citation_count, tracking_location
  ) values (
    v_project, v_metric_date, 'Skin', 'chatgpt', 'Legacy competitor sentinel',
    'https://legacy-competitor.example', 12.5, 3, 'MY'
  );

  insert into public.direct_competitors (
    project_id, category, normalized_domain, brand_name, website, first_seen_date, last_seen_date
  ) values (
    v_project, 'Skin', 'direct-competitor.example', 'Direct competitor sentinel',
    'https://direct-competitor.example', v_metric_date, v_metric_date
  ) returning id into v_direct_competitor;

  insert into public.direct_competitor_observations (
    competitor_id, project_id, metric_date, tracking_location, llm_provider,
    presence_count, response_count, citation_count
  ) values (
    v_direct_competitor, v_project, v_metric_date, 'MY', 'chatgpt', 1, 1, 2
  );

  -- First publication: all six derived datasets are staged and promoted together.
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
    v_project, v_prompt, 'chatgpt', now(), 'Derived replacement prompt',
    '{"generation":"old"}'::jsonb, 'Old candidate response', 'completed', v_old_run, 'MY'
  ) returning id into v_old_response;

  perform public.stage_tracking_candidate_rows(v_old_run, 'citations',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'url', v_old_url, 'page_name', 'Old source',
      'brand_name', 'Synthetic Derived Replacement Brand', 'is_brand_related', true,
      'frequency', 1, 'prompt_id', v_prompt, 'tracking_location', 'MY'
    )));
  perform public.stage_tracking_candidate_rows(v_old_run, 'citation_occurrences',
    jsonb_build_array(
      jsonb_build_object(
        'project_id', v_project, 'response_id', v_old_response, 'entity_id', v_brand,
        'category', 'Skin', 'metric_date', v_metric_date, 'provider', 'chatgpt',
        'tracking_location', 'MY', 'run_id', v_old_run, 'citation_url', v_old_url,
        'canonical_url', v_old_url, 'canonical_domain', 'old-source.example', 'citation_index', 1
      ),
      jsonb_build_object(
        'project_id', v_project, 'response_id', v_old_response, 'entity_id', v_competitor_brand,
        'category', 'Skin', 'metric_date', v_metric_date, 'provider', 'chatgpt',
        'tracking_location', 'MY', 'run_id', v_old_run, 'citation_url', 'https://old-competitor.example/review',
        'canonical_url', 'https://old-competitor.example/review', 'canonical_domain', 'old-competitor.example', 'citation_index', 2
      )
    ));
  perform public.stage_tracking_candidate_rows(v_old_run, 'response_brand_evidence',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'response_id', v_old_response, 'brand_id', v_brand,
      'category', 'Skin', 'match_source', 'citation_domain', 'matched_value', 'old-source.example',
      'evidence_text', v_old_url, 'first_position', null, 'occurrence_count', 1, 'confidence', 'deterministic'
    )));
  perform public.stage_tracking_candidate_rows(v_old_run, 'third_party_mentions',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'response_id', v_old_response, 'metric_date', v_metric_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'url', v_old_url, 'canonical_url', v_old_url, 'hostname', 'old-source.example',
      'website_name', 'Old source', 'source_type', 'citation_annotation',
      'associated_brand_ids', jsonb_build_array(v_brand),
      'associated_brand_names', jsonb_build_array('Synthetic Derived Replacement Brand'),
      'association_status', 'inferred', 'frequency', 1
    )));
  perform public.stage_tracking_candidate_rows(v_old_run, 'category_brand_observations',
    jsonb_build_array(
      jsonb_build_object(
        'project_id', v_project, 'brand_id', v_brand, 'category', 'Skin',
        'metric_date', v_metric_date, 'tracking_location', 'MY', 'llm_provider', 'chatgpt',
        'presence_count', 0, 'response_count', 1, 'mention_count', 0, 'citation_count', 1,
        'average_position', null, 'run_id', v_old_run
      ),
      jsonb_build_object(
        'project_id', v_project, 'brand_id', v_competitor_brand, 'category', 'Skin',
        'metric_date', v_metric_date, 'tracking_location', 'MY', 'llm_provider', 'chatgpt',
        'presence_count', 1, 'response_count', 1, 'mention_count', 2, 'citation_count', 1,
        'average_position', 2, 'run_id', v_old_run
      )
    ));
  perform public.stage_tracking_candidate_rows(v_old_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', v_old_run,
      'visibility_score', 0, 'visibility_rank', null, 'rank_population_count', null,
      'rank_population_status', 'unverified', 'citation_count', 1, 'presence_count', 0, 'response_count', 1
    )));

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_old_run;

  v_result := public.promote_tracking_run_candidate(v_old_run, null);
  if v_result->>'status' <> 'published' then
    raise exception 'original derived-data candidate did not publish: %', v_result;
  end if;

  -- Replacement candidate: same exact project/date/category/provider/location.
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
    v_project, v_prompt, 'chatgpt', now(), 'Derived replacement prompt',
    '{"generation":"new"}'::jsonb, 'New candidate response', 'completed', v_new_run, 'MY'
  ) returning id into v_new_response;

  perform public.stage_tracking_candidate_rows(v_new_run, 'citations',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'url', v_new_url, 'page_name', 'New source',
      'brand_name', 'Synthetic Derived Replacement Brand', 'is_brand_related', true,
      'frequency', 2, 'prompt_id', v_prompt, 'tracking_location', 'MY'
    )));
  perform public.stage_tracking_candidate_rows(v_new_run, 'citation_occurrences',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'response_id', v_new_response, 'entity_id', v_brand,
      'category', 'Skin', 'metric_date', v_metric_date, 'provider', 'chatgpt',
      'tracking_location', 'MY', 'run_id', v_new_run, 'citation_url', v_new_url,
      'canonical_url', v_new_url, 'canonical_domain', 'new-source.example', 'citation_index', 1
    )));
  perform public.stage_tracking_candidate_rows(v_new_run, 'response_brand_evidence',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'response_id', v_new_response, 'brand_id', v_brand,
      'category', 'Skin', 'match_source', 'citation_domain', 'matched_value', 'new-source.example',
      'evidence_text', v_new_url, 'first_position', null, 'occurrence_count', 1, 'confidence', 'deterministic'
    )));
  perform public.stage_tracking_candidate_rows(v_new_run, 'third_party_mentions',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'response_id', v_new_response, 'metric_date', v_metric_date,
      'category', 'Skin', 'llm_provider', 'chatgpt', 'tracking_location', 'MY',
      'url', v_new_url, 'canonical_url', v_new_url, 'hostname', 'new-source.example',
      'website_name', 'New source', 'source_type', 'citation_annotation',
      'associated_brand_ids', jsonb_build_array(v_brand),
      'associated_brand_names', jsonb_build_array('Synthetic Derived Replacement Brand'),
      'association_status', 'inferred', 'frequency', 2
    )));
  perform public.stage_tracking_candidate_rows(v_new_run, 'category_brand_observations',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'brand_id', v_brand, 'category', 'Skin',
      'metric_date', v_metric_date, 'tracking_location', 'MY', 'llm_provider', 'chatgpt',
      'presence_count', 0, 'response_count', 1, 'mention_count', 0, 'citation_count', 2,
      'average_position', null, 'run_id', v_new_run
    )));
  perform public.stage_tracking_candidate_rows(v_new_run, 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', v_project, 'metric_date', v_metric_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', v_new_run,
      'visibility_score', 0, 'visibility_rank', null, 'rank_population_count', null,
      'rank_population_status', 'unverified', 'citation_count', 2, 'presence_count', 0, 'response_count', 1
    )));

  update public.tracking_runs
  set status = 'completed', completed_prompts = 1, completed_at = now()
  where id = v_new_run;

  v_result := public.promote_tracking_run_candidate(v_new_run, null);
  if v_result->>'status' <> 'published' then
    raise exception 'derived-data replacement did not publish: %', v_result;
  end if;

  if exists (select 1 from public.tracking_runs where id = v_old_run)
     or exists (select 1 from public.ai_responses where id = v_old_response) then
    raise exception 'predecessor run or raw response survived replacement';
  end if;

  if exists (select 1 from public.response_brand_evidence where response_id = v_old_response)
     or not exists (select 1 from public.response_brand_evidence where response_id = v_new_response and brand_id = v_brand) then
    raise exception 'response_brand_evidence was not replaced with candidate-owned evidence';
  end if;

  if exists (select 1 from public.citation_occurrences where response_id = v_old_response)
     or not exists (select 1 from public.citation_occurrences where response_id = v_new_response and run_id = v_new_run and entity_id = v_brand)
     or exists (select 1 from public.citation_occurrences where response_id = v_new_response and entity_id = v_competitor_brand) then
    raise exception 'citation_occurrences retained predecessor evidence or competitor citations absent from the replacement';
  end if;

  if exists (select 1 from public.third_party_mentions where response_id = v_old_response)
     or not exists (select 1 from public.third_party_mentions where response_id = v_new_response and canonical_url = v_new_url) then
    raise exception 'third_party_mentions was not replaced with candidate-owned mentions';
  end if;

  if exists (
    select 1 from public.citations
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Skin' and llm_provider = 'chatgpt' and tracking_location = 'MY'
      and url <> v_new_url
  ) or not exists (
    select 1 from public.citations
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Skin' and llm_provider = 'chatgpt' and tracking_location = 'MY'
      and url = v_new_url and frequency = 2
  ) then
    raise exception 'date-grain citations were not replaced by the candidate citation set';
  end if;

  if exists (
    select 1 from public.category_brand_observations
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Skin' and llm_provider = 'chatgpt'
      and tracking_location = 'MY' and run_id is distinct from v_new_run
  ) or not exists (
    select 1 from public.category_brand_observations
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Skin' and llm_provider = 'chatgpt'
      and tracking_location = 'MY' and run_id = v_new_run and brand_id = v_brand and citation_count = 2
  ) or exists (
    select 1 from public.category_brand_observations
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Skin' and llm_provider = 'chatgpt'
      and tracking_location = 'MY' and brand_id = v_competitor_brand
  ) then
    raise exception 'category_brand_observations retained a competitor row omitted by the replacement';
  end if;

  if not exists (
    select 1 from public.visibility_daily
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Skin' and llm_provider = 'chatgpt'
      and tracking_location = 'MY' and run_id = v_new_run and citation_count = 2
  ) then
    raise exception 'visibility_daily does not reflect candidate citation metrics';
  end if;

  -- Overall must be rebuilt from the replacement's citation count and competitor set.
  -- The predecessor included this competitor; the replacement intentionally does not.
  if not exists (
    select 1 from public.visibility_daily
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Overall' and llm_provider = 'Overall'
      and tracking_location = 'MY' and citation_count = 2
      and source_run_ids = array[v_new_run]::uuid[]
  ) then
    raise exception 'Overall citation aggregate was not rebuilt from the replacement category run';
  end if;

  if exists (
    select 1 from public.category_brand_observations
    where project_id = v_project and metric_date = v_metric_date
      and category = 'Overall' and llm_provider = 'chatgpt'
      and tracking_location = 'MY' and brand_id = v_competitor_brand
  ) then
    raise exception 'Overall retained a competitor observation omitted by the replacement';
  end if;

  if not exists (
    select 1 from public.competitors
    where project_id = v_project and brand_name = 'Legacy competitor sentinel'
  ) then
    raise exception 'legacy competitors row was unexpectedly changed';
  end if;

  if not exists (
    select 1 from public.direct_competitors
    where id = v_direct_competitor and project_id = v_project
  ) or not exists (
    select 1 from public.direct_competitor_observations
    where competitor_id = v_direct_competitor and project_id = v_project
      and metric_date = v_metric_date and tracking_location = 'MY'
  ) then
    raise exception 'direct competitor configuration or observations were unexpectedly changed';
  end if;
end
$$;

rollback;
select 'replacement rerun derived-data behavioural tests passed' as result;
