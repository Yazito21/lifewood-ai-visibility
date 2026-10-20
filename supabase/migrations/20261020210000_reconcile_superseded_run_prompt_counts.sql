-- Superseded runs are intentionally marked failed and their response rows are replaced
-- by the successful rerun. Keep prompt counters internally consistent for reporting.
UPDATE public.tracking_runs
SET failed_prompts = greatest(total_prompts - completed_prompts, 0)
WHERE status = 'failed'
  AND coalesce(error_message, '') ILIKE 'Superseded by%'
  AND completed_prompts + failed_prompts <> total_prompts;
