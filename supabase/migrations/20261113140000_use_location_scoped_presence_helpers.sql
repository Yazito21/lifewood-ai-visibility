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
