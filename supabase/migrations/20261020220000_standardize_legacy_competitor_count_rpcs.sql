-- Keep legacy public RPCs aligned with the canonical direct-competitor registry.
-- Both return the tracked brand plus the distinct competitors observed in the period.
CREATE OR REPLACE FUNCTION public.get_competitor_counts_for_period(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_tracking_location text DEFAULT NULL::text
)
RETURNS TABLE(topic text, metric_date date, competitor_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT m.topic, m.metric_date, m.competitor_count
  FROM public.get_direct_competitor_metrics_for_period(
    p_project_id, p_start_date, p_end_date, p_tracking_location
  ) m;
$function$;

CREATE OR REPLACE FUNCTION public.get_latest_competitor_counts(
  p_project_id uuid,
  p_tracking_location text DEFAULT NULL::text
)
RETURNS TABLE(topic text, metric_date date, competitor_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT m.topic, m.metric_date, m.competitor_count
  FROM public.get_direct_competitor_metrics_for_period(
    p_project_id,
    DATE '1900-01-01',
    (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,
    p_tracking_location
  ) m;
$function$;
