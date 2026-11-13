-- Keep legacy SQL consumers aligned with the location-aware presence helper.
-- The two-argument helper remains for compatibility, but must not be used where
-- the caller already knows the exact tracking location.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.check_metric_integrity(uuid,date,date)'::regprocedure)
    into v_definition;
  if position('public.run_tracked_presence(v.run_id, v.category)' in v_definition) = 0 then
    raise exception 'Expected check_metric_integrity presence call was not found';
  end if;
  execute replace(
    v_definition,
    'public.run_tracked_presence(v.run_id, v.category)',
    'public.run_tracked_presence(v.run_id, v.category, v.tracking_location)'
  );

  select pg_get_functiondef('public.publish_cross_engine_metrics(uuid,date,text)'::regprocedure)
    into v_definition;
  if position('public.run_tracked_presence(m.run_id, m.category)' in v_definition) = 0 then
    raise exception 'Expected publish_cross_engine_metrics presence call was not found';
  end if;
  execute replace(
    v_definition,
    'public.run_tracked_presence(m.run_id, m.category)',
    'public.run_tracked_presence(m.run_id, m.category, p_location)'
  );

  select pg_get_functiondef('public.publish_engine_overall_metrics(uuid,date,text,text,boolean)'::regprocedure)
    into v_definition;
  if position('public.run_tracked_presence(m.run_id, m.category)' in v_definition) = 0 then
    raise exception 'Expected publish_engine_overall_metrics presence call was not found';
  end if;
  execute replace(
    v_definition,
    'public.run_tracked_presence(m.run_id, m.category)',
    'public.run_tracked_presence(m.run_id, m.category, p_location)'
  );

  -- A single tracking_runs row can own responses/metrics for several locations.
  -- Select topic members by their per-location visibility_daily rows rather than
  -- the run row's legacy single tracking_location field.
  select pg_get_functiondef('public.publish_engine_overall_metrics(uuid,date,text,text,boolean)'::regprocedure)
    into v_definition;
  if position('and tr.tracking_location = p_location' in v_definition) = 0 then
    raise exception 'Expected publish_engine_overall_metrics location filter was not found';
  end if;
  execute replace(
    v_definition,
    'and tr.tracking_location = p_location',
    'and exists (select 1 from public.visibility_daily vloc where vloc.run_id = tr.id and vloc.project_id = p_project_id and vloc.metric_date = p_metric_date and vloc.category = tr.category and vloc.llm_provider = p_provider and vloc.tracking_location = p_location)'
  );

  select pg_get_functiondef('public.publish_cross_engine_metrics(uuid,date,text)'::regprocedure)
    into v_definition;
  if position('and tr.tracking_location = p_location' in v_definition) = 0 then
    raise exception 'Expected publish_cross_engine_metrics location filter was not found';
  end if;
  execute replace(
    v_definition,
    'and tr.tracking_location = p_location',
    'and exists (select 1 from public.visibility_daily vloc where vloc.run_id = tr.id and vloc.project_id = p_project_id and vloc.metric_date = p_metric_date and vloc.category = tr.category and vloc.llm_provider = tr.provider and vloc.tracking_location = p_location)'
  );

  select pg_get_functiondef('public.recompute_competitor_metrics(uuid,date,date)'::regprocedure)
    into v_definition;
  if position('public.run_tracked_presence(fr.id, tn)' in v_definition) = 0 then
    raise exception 'Expected recompute_competitor_metrics presence call was not found';
  end if;
  execute replace(
    v_definition,
    'public.run_tracked_presence(fr.id, tn)',
    'public.run_tracked_presence(fr.id, tn, fr.tracking_location)'
  );
end;
$$;
