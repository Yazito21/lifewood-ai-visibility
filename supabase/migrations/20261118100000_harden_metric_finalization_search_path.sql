-- Harden the remaining SECURITY DEFINER metric helpers against search_path shadowing.
-- These helpers are invoked by the replacement publication transaction and must
-- retain the same fixed path contract as the candidate/promotion RPCs.

alter function public.run_tracked_presence(uuid, text, text)
  set search_path = public, pg_temp;

alter function public.finalize_run_metrics(uuid)
  set search_path = public, pg_temp;
