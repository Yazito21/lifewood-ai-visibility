ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tracking_locations text[];
UPDATE public.projects
SET tracking_locations = ARRAY[COALESCE(NULLIF(tracking_market, ''), 'MY')]
WHERE tracking_locations IS NULL OR cardinality(tracking_locations) = 0;
ALTER TABLE public.projects ALTER COLUMN tracking_locations SET DEFAULT ARRAY['MY']::text[];
ALTER TABLE public.projects ALTER COLUMN tracking_locations SET NOT NULL;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_tracking_locations_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_tracking_locations_check
  CHECK (cardinality(tracking_locations) BETWEEN 1 AND 50 AND (
    tracking_locations = ARRAY['GLOBAL']::text[]
    OR array_to_string(tracking_locations, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
    OR array_to_string(tracking_locations, ',') ~ '^REGION:[A-Z0-9_]+(,REGION:[A-Z0-9_]+)*$'
  ));
COMMENT ON COLUMN public.projects.tracking_locations IS
  'Selected tracking locations: one or more ISO alpha-2 countries, one or more REGION:<region-key> values, or GLOBAL alone. Country and region selections cannot be mixed.';
ALTER TABLE public.ai_responses ADD COLUMN IF NOT EXISTS tracking_location text;
COMMENT ON COLUMN public.ai_responses.tracking_location IS
  'ISO alpha-2 country code used for this AI response, or GLOBAL when location was unspecified.';
