-- Preserve the cross-provider Overall pool when one provider/category is replaced.
-- The per-engine aggregate must not overwrite the shared Overall-provider rows on multi-engine days.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef(
    'public.promote_tracking_run_candidate(uuid,uuid)'::regprocedure
  );

  v_old := '  v_aggregate uuid;';
  v_new := '  v_aggregate uuid;
  v_has_other_provider boolean;';
  if position(v_old in v_definition) = 0 then
    raise exception 'promotion function declaration anchor not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
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
$old$;
  v_new := $new$
    -- A per-provider aggregate may write the shared 'Overall' provider row only
    -- when no other provider has a published run in this project/date/location.
    select exists (
      select 1
      from public.tracking_runs tx
      where tx.project_id = v_run.project_id
        and tx.tracking_location = v_location
        and tx.run_kind = 'category'
        and tx.status = 'completed'
        and tx.published_at is not null
        and tx.superseded_at is null
        and tx.provider <> 'Overall'
        and tx.provider <> v_run.provider
        and (tx.published_at at time zone 'Asia/Kuala_Lumpur')::date = v_date
    ) into v_has_other_provider;

    if v_has_other_provider then
      -- Rebuild the provider-specific aggregate without touching the shared row,
      -- then rebuild the shared pool from every active provider/category run.
      perform public.publish_engine_overall_metrics(
        v_run.project_id, v_date, v_location, v_run.provider, false
      );
      v_aggregate := public.publish_cross_engine_metrics(
        v_run.project_id, v_date, v_location
      );
    else
      v_aggregate := public.publish_engine_overall_metrics(
        v_run.project_id, v_date, v_location, v_run.provider, true
      );
    end if;

    -- If category coverage is incomplete, invalidate the shared Overall snapshot.
    -- Cross-engine aggregates use provider='Overall'; per-engine aggregates use
    -- the engine provider. Restrict this to category IS NULL so valid per-category
    -- cross-engine aggregates remain published.
    if v_aggregate is null then
      update public.tracking_runs
      set superseded_at = coalesce(superseded_at, now())
      where project_id = v_run.project_id
        and provider in ('Overall', v_run.provider)
        and category is null
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
        and llm_provider in ('Overall', v_run.provider);

      delete from public.visibility_daily
      where project_id = v_run.project_id
        and category = 'Overall'
        and metric_date = v_date
        and tracking_location = v_location
        and llm_provider in ('Overall', v_run.provider)
        and run_id in (
          select id from public.tracking_runs
          where project_id = v_run.project_id
            and provider in ('Overall', v_run.provider)
            and category is null
            and tracking_location = v_location
            and run_kind = 'overall_aggregate'
            and (published_at at time zone 'Asia/Kuala_Lumpur')::date = v_date
        );
    end if;
$new$;

  if position(v_old in v_definition) = 0 then
    raise exception 'promotion Overall block anchor not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end
$migration$;

comment on function public.promote_tracking_run_candidate(uuid, uuid) is
  'Atomically promotes one completed category-scoped candidate, replaces exact-date/location predecessor data, records audit snapshots, and rebuilds provider-specific and cross-provider Overall metrics without overwriting a multi-engine pool.';
