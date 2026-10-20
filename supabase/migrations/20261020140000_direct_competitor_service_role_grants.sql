-- The historical backfill Edge Function uses the Supabase service role.
-- These new tables were created without the service_role table privileges needed for
-- SELECT and idempotent UPSERT. Keep RLS enabled; this grants no access to anon/public.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.direct_competitors, public.direct_competitor_observations
TO service_role;

-- Browser users can read only through the existing authenticated + project-member RLS policies.
GRANT SELECT
ON TABLE public.direct_competitors, public.direct_competitor_observations
TO authenticated;

