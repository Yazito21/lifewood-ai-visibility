-- The visibility-tracking Edge Function uses the service-role client for trusted run management.
-- Restore the DML permissions needed to inspect the daily claim and replace same-day outputs.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tracking_run_daily_claims TO service_role;
GRANT DELETE ON TABLE public.tracking_runs TO service_role;
GRANT DELETE ON TABLE public.ai_responses TO service_role;
GRANT DELETE ON TABLE public.citations TO service_role;
GRANT DELETE ON TABLE public.competitors TO service_role;
GRANT DELETE ON TABLE public.visibility_daily TO service_role;
