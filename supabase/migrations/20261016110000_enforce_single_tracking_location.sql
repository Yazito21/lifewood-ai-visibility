-- Tracking is configured for exactly one country or Global.
UPDATE public.projects
SET tracking_locations = ARRAY[
  CASE
    WHEN tracking_locations @> ARRAY['GLOBAL']::text[] THEN 'GLOBAL'
    WHEN cardinality(tracking_locations) > 0 AND tracking_locations[1] ~ '^[A-Z]{2}$' THEN tracking_locations[1]
    WHEN tracking_market ~ '^[A-Z]{2}$' THEN tracking_market
    WHEN tracking_market = 'GLOBAL' THEN 'GLOBAL'
    ELSE 'MY'
  END
];
UPDATE public.projects
SET tracking_market = tracking_locations[1];
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_tracking_locations_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_tracking_locations_check
  CHECK (
    cardinality(tracking_locations) = 1
    AND (
      tracking_locations = ARRAY['GLOBAL']::text[]
      OR tracking_locations[1] ~ '^[A-Z]{2}$'
    )
  );
COMMENT ON COLUMN public.projects.tracking_locations IS
  'Exactly one selected tracking location: an ISO alpha-2 country code or GLOBAL.';
