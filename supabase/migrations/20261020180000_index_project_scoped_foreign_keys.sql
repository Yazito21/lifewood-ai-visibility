-- Cover foreign-key lookups used by project-scoped response, citation, membership,
-- and tracking-run workflows as the number of tracked brands grows.
CREATE INDEX IF NOT EXISTS ai_responses_prompt_id_idx
  ON public.ai_responses (prompt_id)
  WHERE prompt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS citations_prompt_id_idx
  ON public.citations (prompt_id)
  WHERE prompt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_members_user_id_idx
  ON public.project_members (user_id);

CREATE INDEX IF NOT EXISTS projects_created_by_idx
  ON public.projects (created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS tracking_run_daily_claims_started_by_idx
  ON public.tracking_run_daily_claims (started_by)
  WHERE started_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS tracking_runs_started_by_idx
  ON public.tracking_runs (started_by)
  WHERE started_by IS NOT NULL;
