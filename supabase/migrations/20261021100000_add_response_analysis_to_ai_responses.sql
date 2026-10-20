-- Store structured extraction separately from the untouched provider payload.
-- Existing RLS policies on ai_responses continue to govern access to this column.
ALTER TABLE public.ai_responses
  ADD COLUMN IF NOT EXISTS response_analysis jsonb NOT NULL DEFAULT '{"status":"not_run","entities":[]}'::jsonb;

COMMENT ON COLUMN public.ai_responses.response_analysis IS
  'Derived entity extraction and research-source metadata. raw_response remains the original provider payload.';
