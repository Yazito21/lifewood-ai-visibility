-- TRK-09: serialize daily entitlement claims and recover abandoned claims.
-- The unique project/date claim remains the source of truth. A claim can only
-- be reclaimed after its lease window has elapsed; an active run is never
-- displaced before that timeout.
CREATE OR REPLACE FUNCTION public.claim_daily_tracking_run(
  p_project_id uuid,
  p_started_by uuid,
  p_run_id uuid,
  p_total_prompts integer
)
RETURNS TABLE(claimed boolean, run_id uuid, status text, started_at timestamptz, run_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_existing_run_id uuid;
  v_existing_started_at timestamptz;
  v_existing_status text;
  v_claim_created_at timestamptz;
  v_now timestamptz := now();
  v_lease interval := interval '30 minutes';
BEGIN
  IF p_project_id IS NULL OR p_started_by IS NULL OR p_run_id IS NULL
     OR p_total_prompts IS NULL OR p_total_prompts < 1 THEN
    RAISE EXCEPTION 'Invalid daily tracking claim arguments';
  END IF;

  -- Transaction-scoped lock prevents concurrent requests from racing through
  -- stale-claim recovery and replacing one another.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_project_id::text || ':' || v_date::text, 0));

  SELECT c.run_id, c.created_at, tr.status, tr.started_at
    INTO v_existing_run_id, v_claim_created_at, v_existing_status, v_existing_started_at
  FROM public.tracking_run_daily_claims c
  LEFT JOIN public.tracking_runs tr ON tr.id = c.run_id
  WHERE c.project_id = p_project_id AND c.run_date = v_date
  FOR UPDATE OF c;

  IF v_existing_run_id IS NOT NULL THEN
    IF v_claim_created_at < v_now - v_lease THEN
      -- A run with a stale lease is abandoned. Finalize it before allowing
      -- today's entitlement to be claimed again; retain all response history.
      UPDATE public.tracking_runs
      SET status = CASE
            WHEN coalesce(completed_prompts, 0) > 0 THEN 'partial'
            ELSE 'failed'
          END,
          error_message = concat_ws(' ', nullif(error_message, ''),
            'Daily entitlement lease expired; claim recovered by TRK-09.'),
          completed_at = coalesce(completed_at, v_now)
      WHERE id = v_existing_run_id AND status = 'running';

      DELETE FROM public.tracking_run_daily_claims
      WHERE project_id = p_project_id AND run_date = v_date
        AND run_id = v_existing_run_id;
    ELSE
      RETURN QUERY SELECT false, v_existing_run_id,
        coalesce(v_existing_status, 'unknown'),
        coalesce(v_existing_started_at, v_claim_created_at), v_date;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.tracking_runs (
    id, project_id, started_by, provider, status,
    total_prompts, completed_prompts, failed_prompts, started_at
  )
  VALUES (
    p_run_id, p_project_id, p_started_by, 'chatgpt', 'running',
    p_total_prompts, 0, 0, v_now
  );

  INSERT INTO public.tracking_run_daily_claims (project_id, run_date, run_id, started_by)
  VALUES (p_project_id, v_date, p_run_id, p_started_by);

  RETURN QUERY SELECT true, p_run_id, 'running'::text, v_now, v_date;
EXCEPTION WHEN unique_violation THEN
  -- Defensive fallback for any writer that does not use the advisory lock.
  DELETE FROM public.tracking_runs WHERE id = p_run_id AND status = 'running';
  SELECT c.run_id, c.created_at, tr.status, tr.started_at
    INTO v_existing_run_id, v_claim_created_at, v_existing_status, v_existing_started_at
  FROM public.tracking_run_daily_claims c
  LEFT JOIN public.tracking_runs tr ON tr.id = c.run_id
  WHERE c.project_id = p_project_id AND c.run_date = v_date;
  RETURN QUERY SELECT false, v_existing_run_id,
    coalesce(v_existing_status, 'unknown'),
    coalesce(v_existing_started_at, v_claim_created_at), v_date;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_daily_tracking_run(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_tracking_run(uuid, uuid, uuid, integer) TO service_role;
