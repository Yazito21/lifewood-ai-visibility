-- Atomic category-scoped replacement.
-- This is intentionally limited to topic/category candidates. Full-run candidates
-- remain unpublished until their category-slicing semantics are separately designed.
create or replace function public.promote_tracking_run_candidate(
  p_run_id uuid,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.tracking_runs%rowtype;
  v_old public.tracking_runs%rowtype;
  v_validation jsonb;
  v_preview jsonb;
  v_date date;
  v_locations text[];
  v_predecessors uuid[] := array[]::uuid[];
  v_first_predecessor uuid;
  v_location text;
  v_deleted jsonb;
  v_audit_count integer := 0;
  v_rows integer;
  v_aggregate uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_run
  from public.tracking_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'tracking_run_not_found';
  end if;

  if v_run.status <> 'completed' or v_run.published_at is not null then
    raise exception 'candidate_must_be_completed_and_unpublished';
  end if;

  if v_run.category is null or v_run.run_kind is distinct from 'topic' then
    raise exception 'only_category_scoped_topic_candidates_can_be_promoted';
  end if;

  v_validation := public.validate_tracking_run_candidate(p_run_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then
    raise exception 'candidate_validation_failed: %', v_validation->'errors';
  end if;

  v_preview := public.preview_tracking_run_replacement(p_run_id);
  if coalesce((v_preview->>'ready_for_promotion')::boolean, false) is not true then
    raise exception 'candidate_replacement_preview_not_ready';
  end if;

  v_date := (v_preview->>'metric_date')::date;
  select coalesce(array_agg(distinct row_data->>'tracking_location' order by row_data->>'tracking_location'), array[]::text[])
    into v_locations
  from public.tracking_run_candidate_rows
  where run_id = p_run_id
    and table_key = 'visibility_daily'
    and row_data->>'llm_provider' = v_run.provider
    and row_data->>'category' = v_run.category
    and (row_data->>'metric_date')::date = v_date;

  if coalesce(cardinality(v_locations), 0) = 0 then
    raise exception 'candidate_has_no_valid_locations';
  end if;
  if not (v_run.tracking_location = any(v_locations)) then
    raise exception 'candidate_primary_location_not_in_metric_scope';
  end if;

  -- Every staged date-grain row must match the candidate's exact project/date/category,
  -- location set and provider. The Overall provider is allowed only for visibility_daily.
  if exists (
    select 1
    from public.tracking_run_candidate_rows s
    where s.run_id = p_run_id
      and (
        (s.row_data ? 'project_id' and nullif(s.row_data->>'project_id', '')::uuid is distinct from v_run.project_id)
        or (s.row_data ? 'metric_date' and (s.row_data->>'metric_date')::date <> v_date)
        or (s.row_data ? 'category' and s.row_data->>'category' is distinct from v_run.category)
        or (s.row_data ? 'tracking_location' and not (s.row_data->>'tracking_location' = any(v_locations)))
        or (s.row_data ? 'llm_provider'
            and s.row_data->>'llm_provider' <> v_run.provider
            and not (s.table_key = 'visibility_daily' and s.row_data->>'llm_provider' = 'Overall'))
        or (s.row_data ? 'provider' and s.row_data->>'provider' is distinct from v_run.provider)
        or (s.row_data ? 'run_id' and nullif(s.row_data->>'run_id', '')::uuid is distinct from p_run_id)
      )
  ) then
    raise exception 'staged_rows_do_not_match_exact_candidate_scope';
  end if;

  -- Serialize replacements for this exact project/date/category/provider scope.
  perform pg_advisory_xact_lock(hashtextextended(
    v_run.project_id::text || '|' || v_date::text || '|' || v_run.category || '|' || v_run.provider,
    0
  ));
  perform 1 from public.projects where id = v_run.project_id for update;

  select coalesce(array_agg(distinct (item->>'run_id')::uuid order by (item->>'run_id')::uuid), array[]::uuid[])
    into v_predecessors
  from jsonb_array_elements(coalesce(v_preview->'predecessors', '[]'::jsonb)) item;

  if exists (
    select 1
    from public.visibility_daily vd
    left join public.tracking_runs old on old.id = vd.run_id
    where vd.project_id = v_run.project_id
      and vd.metric_date = v_date
      and vd.category = v_run.category
      and vd.llm_provider = v_run.provider
      and vd.tracking_location = any(v_locations)
      and (
        vd.run_id is null
        or old.id is null
        or old.status <> 'completed'
        or old.published_at is null
      )
  ) then
    raise exception 'existing_canonical_metric_has_missing_or_unpublished_run_lineage';
  end if;

  -- A category replacement must never delete a full run or a topic slice whose
  -- raw responses are owned by a shared source run. Those require a separate
  -- migration/slicing workflow and are rejected rather than partially deleted.
  if exists (
    select 1
    from public.tracking_runs old
    where old.id = any(v_predecessors)
      and (
        old.project_id <> v_run.project_id
        or old.provider <> v_run.provider
        or old.category is distinct from v_run.category
        or old.run_kind is distinct from 'topic'
        or old.source_run_id is not null
        or old.status <> 'completed'
        or old.published_at is null
        or (old.published_at at time zone 'Asia/Kuala_Lumpur')::date <> v_date
      )
  ) then
    raise exception 'predecessor_contains_unsupported_or_cross_scope_run';
  end if;

  if exists (
    select 1
    from public.tracking_runs child
    where child.source_run_id = any(v_predecessors)
  ) then
    raise exception 'predecessor_is_referenced_as_source_run';
  end if;

  if exists (
    select 1
    from public.visibility_daily vd
    where vd.run_id = any(v_predecessors)
      and vd.project_id = v_run.project_id
      and vd.metric_date = v_date
      and vd.category <> v_run.category
  ) then
    raise exception 'predecessor_run_contains_other_category_metrics';
  end if;

  if exists (
    select 1
    from public.ai_responses ar
    left join public.prompts pr on pr.id = ar.prompt_id
    where ar.run_id = any(v_predecessors)
      and (
        pr.category is distinct from v_run.category
        or ar.tracking_location is null
        or not (ar.tracking_location = any(v_locations))
        or (ar.captured_at at time zone 'Asia/Kuala_Lumpur')::date <> v_date
      )
  ) then
    raise exception 'predecessor_raw_responses_extend_beyond_replacement_scope';
  end if;

  select id into v_first_predecessor
  from public.tracking_runs
  where id = any(v_predecessors)
  order by id
  limit 1;

  -- Preserve daily entitlement if it still points to a predecessor being removed.
  update public.tracking_run_daily_claims
  set run_id = p_run_id
  where project_id = v_run.project_id
    and run_date = v_date
    and run_id = any(v_predecessors);

  -- Write a durable per-location audit snapshot before deleting predecessor data.
  for v_old in
    select * from public.tracking_runs
    where id = any(v_predecessors)
    order by id
  loop
    for v_location in
      select distinct scoped.tracking_location
      from (
        select ar.tracking_location
        from public.ai_responses ar
        where ar.run_id = v_old.id
          and ar.tracking_location = any(v_locations)
        union
        select vd.tracking_location
        from public.visibility_daily vd
        where vd.run_id = v_old.id
          and vd.project_id = v_run.project_id
          and vd.metric_date = v_date
          and vd.category = v_run.category
          and vd.tracking_location = any(v_locations)
        union
        select v_old.tracking_location
        where v_old.tracking_location = any(v_locations)
      ) scoped
      where scoped.tracking_location is not null
      order by scoped.tracking_location
    loop
      select jsonb_build_object(
        'raw_responses', (
          select count(*) from public.ai_responses ar
          where ar.run_id = v_old.id and ar.tracking_location = v_location
        ),
        'response_brand_evidence', (
          select count(*) from public.response_brand_evidence e
          join public.ai_responses ar on ar.id = e.response_id
          where ar.run_id = v_old.id and ar.tracking_location = v_location
        ),
        'citation_occurrences', (
          select count(*) from public.citation_occurrences co
          where co.project_id = v_run.project_id and co.metric_date = v_date
            and co.category = v_run.category and co.provider = v_run.provider
            and co.tracking_location = v_location and co.run_id = v_old.id
        ),
        'third_party_mentions', (
          select count(*) from public.third_party_mentions tm
          join public.ai_responses ar on ar.id = tm.response_id
          where ar.run_id = v_old.id and ar.tracking_location = v_location
            and tm.project_id = v_run.project_id and tm.metric_date = v_date
            and tm.category = v_run.category and tm.llm_provider = v_run.provider
            and tm.tracking_location = v_location
        ),
        'citations', (
          select case when exists (
            select 1 from public.visibility_daily vd
            where vd.run_id = v_old.id and vd.project_id = v_run.project_id
              and vd.metric_date = v_date and vd.category = v_run.category
              and vd.tracking_location = v_location and vd.llm_provider = v_run.provider
          ) then (
            select count(*) from public.citations c
            where c.project_id = v_run.project_id and c.metric_date = v_date
              and c.category = v_run.category and c.llm_provider = v_run.provider
              and c.tracking_location = v_location
          ) else 0 end
        ),
        'category_brand_observations', (
          select count(*) from public.category_brand_observations o
          where o.project_id = v_run.project_id and o.metric_date = v_date
            and o.category = v_run.category and o.llm_provider = v_run.provider
            and o.tracking_location = v_location and o.run_id = v_old.id
        ),
        'visibility_daily', (
          select count(*) from public.visibility_daily vd
          where vd.run_id = v_old.id and vd.project_id = v_run.project_id
            and vd.metric_date = v_date and vd.category = v_run.category
            and vd.tracking_location = v_location
            and vd.llm_provider in ('Overall', v_run.provider)
        )
      ) into v_deleted;

      insert into public.tracking_run_replacements (
        project_id, metric_date, category, provider, tracking_location,
        replacement_run_id, replaced_run_id, replaced_run_snapshot,
        replacement_run_snapshot, deleted_row_counts, replaced_by
      ) values (
        v_run.project_id, v_date, v_run.category, v_run.provider, v_location,
        p_run_id, v_old.id, to_jsonb(v_old), to_jsonb(v_run), v_deleted, p_actor_id
      );
      v_audit_count := v_audit_count + 1;
    end loop;
  end loop;

  -- Mark predecessors superseded before publishing so the publication trigger
  -- cannot accidentally choose a different cross-location predecessor.
  update public.tracking_runs
  set superseded_at = coalesce(superseded_at, now())
  where id = any(v_predecessors);

  -- Remove only data belonging to this exact project/date/category/provider/location scope.
  delete from public.third_party_mentions tm
  where tm.project_id = v_run.project_id
    and tm.metric_date = v_date
    and tm.category = v_run.category
    and tm.llm_provider = v_run.provider
    and tm.tracking_location = any(v_locations);

  delete from public.citation_occurrences co
  where co.project_id = v_run.project_id
    and co.metric_date = v_date
    and co.category = v_run.category
    and co.provider = v_run.provider
    and co.tracking_location = any(v_locations);

  delete from public.response_brand_evidence e
  using public.ai_responses ar
  where e.response_id = ar.id
    and ar.run_id = any(v_predecessors);

  delete from public.ai_responses
  where run_id = any(v_predecessors);

  delete from public.category_brand_observations o
  where o.project_id = v_run.project_id
    and o.metric_date = v_date
    and o.category = v_run.category
    and o.llm_provider = v_run.provider
    and o.tracking_location = any(v_locations);

  delete from public.visibility_daily vd
  where vd.project_id = v_run.project_id
    and vd.metric_date = v_date
    and vd.category = v_run.category
    and vd.tracking_location = any(v_locations)
    and vd.llm_provider in ('Overall', v_run.provider);

  delete from public.citations c
  where c.project_id = v_run.project_id
    and c.metric_date = v_date
    and c.category = v_run.category
    and c.llm_provider = v_run.provider
    and c.tracking_location = any(v_locations);

  delete from public.tracking_runs
  where id = any(v_predecessors);

  -- Promote staged derived rows. Explicit column lists preserve generated IDs/defaults.
  insert into public.citations (
    project_id, metric_date, category, llm_provider, url, page_name, brand_name,
    is_brand_related, frequency, prompt_id, tracking_location
  )
  select
    (jsonb_populate_record(null::public.citations, s.row_data)).project_id,
    (jsonb_populate_record(null::public.citations, s.row_data)).metric_date,
    (jsonb_populate_record(null::public.citations, s.row_data)).category,
    (jsonb_populate_record(null::public.citations, s.row_data)).llm_provider,
    (jsonb_populate_record(null::public.citations, s.row_data)).url,
    (jsonb_populate_record(null::public.citations, s.row_data)).page_name,
    (jsonb_populate_record(null::public.citations, s.row_data)).brand_name,
    (jsonb_populate_record(null::public.citations, s.row_data)).is_brand_related,
    (jsonb_populate_record(null::public.citations, s.row_data)).frequency,
    (jsonb_populate_record(null::public.citations, s.row_data)).prompt_id,
    (jsonb_populate_record(null::public.citations, s.row_data)).tracking_location
  from public.tracking_run_candidate_rows s
  where s.run_id = p_run_id and s.table_key = 'citations';

  insert into public.citation_occurrences (
    project_id, response_id, entity_id, category, metric_date, provider,
    tracking_location, run_id, citation_url, canonical_url, canonical_domain, citation_index
  )
  select
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).project_id,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).response_id,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).entity_id,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).category,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).metric_date,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).provider,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).tracking_location,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).run_id,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).citation_url,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).canonical_url,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).canonical_domain,
    (jsonb_populate_record(null::public.citation_occurrences, s.row_data)).citation_index
  from public.tracking_run_candidate_rows s
  where s.run_id = p_run_id and s.table_key = 'citation_occurrences';

  insert into public.response_brand_evidence (
    project_id, response_id, brand_id, category, match_source, matched_value,
    evidence_text, first_position, occurrence_count, confidence
  )
  select
    (jsonb_populate_record(null::public.response_brand_evidence, s.row_data)).project_id,
    (jsonb_populate_record(null::public.response_brand_evidence, s.row_data)).response_id,
    (jsonb_populate_record(null::public.response_brand_evidence, s.row_data)).brand_id,
    (jsonb_populate_record(null::public.response_brand_evidence, s.row_data)).category,
    (jsonb_populate_record(null::public.response_brand_evidence, s.row_data)).match_source,
    (jsonb_populate_record(null::public.response_brand_evidence, s.row_data)).matched_value,
    (jsonb_populate_record(null::public.response_brand_evidence, s.row_data)).evidence_text,
    (jsonb_populate_record(null::public.response_brand_evidence, s.row_data)).first_position,
    (jsonb_populate_record(null::public.response_brand_evidence, s.row_data)).occurrence_count,
    (jsonb_populate_record(null::public.response_brand_evidence, s.row_data)).confidence
  from public.tracking_run_candidate_rows s
  where s.run_id = p_run_id and s.table_key = 'response_brand_evidence';

  insert into public.third_party_mentions (
    project_id, response_id, metric_date, category, llm_provider, tracking_location,
    url, canonical_url, hostname, website_name, source_type, associated_brand_ids,
    associated_brand_names, association_status, frequency
  )
  select
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).project_id,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).response_id,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).metric_date,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).category,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).llm_provider,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).tracking_location,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).url,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).canonical_url,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).hostname,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).website_name,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).source_type,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).associated_brand_ids,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).associated_brand_names,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).association_status,
    (jsonb_populate_record(null::public.third_party_mentions, s.row_data)).frequency
  from public.tracking_run_candidate_rows s
  where s.run_id = p_run_id and s.table_key = 'third_party_mentions';

  insert into public.category_brand_observations (
    project_id, brand_id, category, metric_date, tracking_location, llm_provider,
    presence_count, response_count, mention_count, citation_count, average_position, run_id
  )
  select
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).project_id,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).brand_id,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).category,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).metric_date,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).tracking_location,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).llm_provider,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).presence_count,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).response_count,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).mention_count,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).citation_count,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).average_position,
    (jsonb_populate_record(null::public.category_brand_observations, s.row_data)).run_id
  from public.tracking_run_candidate_rows s
  where s.run_id = p_run_id and s.table_key = 'category_brand_observations';

  insert into public.visibility_daily (
    project_id, metric_date, category, llm_provider, visibility_score, visibility_rank,
    share_of_voice_score, share_of_voice_rank, average_position, average_position_rank,
    citation_count, tracking_location, run_id, rank_population_count,
    rank_population_status, presence_count, response_count, source_run_ids, metric_version
  )
  select
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).project_id,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).metric_date,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).category,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).llm_provider,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).visibility_score,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).visibility_rank,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).share_of_voice_score,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).share_of_voice_rank,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).average_position,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).average_position_rank,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).citation_count,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).tracking_location,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).run_id,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).rank_population_count,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).rank_population_status,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).presence_count,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).response_count,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).source_run_ids,
    (jsonb_populate_record(null::public.visibility_daily, s.row_data)).metric_version
  from public.tracking_run_candidate_rows s
  where s.run_id = p_run_id and s.table_key = 'visibility_daily';

  -- Publish only after all canonical rows are present. The publication trigger
  -- finalises every location row using the location-aware helper.
  -- Predecessors are physically removed in this transaction, so a
  -- supersedes_run_id FK would immediately become invalid (ON DELETE SET NULL).
  -- Durable lineage is recorded in tracking_run_replacements instead.
  update public.tracking_runs
  set published_at = now(),
      supersedes_run_id = null,
      error_message = null
  where id = p_run_id;

  -- Rebuild the Overall aggregate independently for each location affected.
  foreach v_location in array v_locations loop
    v_aggregate := public.publish_engine_overall_metrics(
      v_run.project_id, v_date, v_location, v_run.provider, true
    );

    -- If one or more categories are still missing, the aggregation function
    -- returns NULL. Remove any previously published Overall snapshot rather
    -- than leave an aggregate that still includes the replaced predecessor.
    if v_aggregate is null then
      update public.tracking_runs
      set superseded_at = coalesce(superseded_at, now())
      where project_id = v_run.project_id
        and provider = v_run.provider
        and tracking_location = v_location
        and run_kind = 'overall_aggregate'
        and published_at is not null
        and superseded_at is null
        and (published_at at time zone 'Asia/Kuala_Lumpur')::date = v_date;

      delete from public.category_brand_observations
      where project_id = v_run.project_id
        and category = 'Overall'
        and metric_date = v_date
        and tracking_location = v_location
        and llm_provider = v_run.provider;

      delete from public.visibility_daily
      where project_id = v_run.project_id
        and category = 'Overall'
        and metric_date = v_date
        and tracking_location = v_location
        and llm_provider in ('Overall', v_run.provider)
        and run_id in (
          select id from public.tracking_runs
          where project_id = v_run.project_id
            and provider = v_run.provider
            and tracking_location = v_location
            and run_kind = 'overall_aggregate'
            and (published_at at time zone 'Asia/Kuala_Lumpur')::date = v_date
        );
    end if;
  end loop;

  delete from public.tracking_run_candidate_rows where run_id = p_run_id;

  return jsonb_build_object(
    'status', 'published',
    'run_id', p_run_id,
    'project_id', v_run.project_id,
    'metric_date', v_date,
    'category', v_run.category,
    'provider', v_run.provider,
    'locations', to_jsonb(v_locations),
    'replaced_run_ids', to_jsonb(v_predecessors),
    'audit_rows', v_audit_count,
    'overall_rebuilt_locations', cardinality(v_locations)
  );
end;
$$;

revoke all on function public.promote_tracking_run_candidate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.promote_tracking_run_candidate(uuid, uuid) to service_role;

comment on function public.promote_tracking_run_candidate(uuid, uuid) is
  'Atomically promotes one completed category-scoped candidate, replaces exact-date/location predecessor data, records audit snapshots, and rebuilds Overall metrics. Full runs and shared-source slices are rejected.';
