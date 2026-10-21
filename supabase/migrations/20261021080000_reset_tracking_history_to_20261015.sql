-- Establish 15 October 2026 as the first retained tracking date for both tracked brands.
-- This migration intentionally removes raw and derived tracking data before the cutoff,
-- as well as the retired LEGACY/location-unknown dataset. Project settings and prompts remain.
DO $$
BEGIN
  IF (
    SELECT count(*) = 2 AND count(DISTINCT brand_name) = 2
    FROM public.projects
    WHERE brand_name IN ('Lifewood Data Technology', 'Dr D Signature Clinic')
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Expected exactly one Lifewood Data Technology project and one Dr D Signature Clinic project; aborting tracking-history cleanup.';
  END IF;
END $$;

-- Delete raw provider payloads and response text first. Also remove any response attached
-- to a run that began before the cutoff, even if an individual response timestamp crossed midnight.
DELETE FROM public.ai_responses r
WHERE r.project_id IN (
  SELECT id FROM public.projects
  WHERE brand_name IN ('Lifewood Data Technology', 'Dr D Signature Clinic')
)
AND (
  (r.captured_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date < DATE '2026-10-15'
  OR r.tracking_location = 'LEGACY'
  OR r.run_id IN (
    SELECT tr.id
    FROM public.tracking_runs tr
    WHERE tr.project_id = r.project_id
      AND (
        (tr.started_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date < DATE '2026-10-15'
        OR tr.tracking_location = 'LEGACY'
      )
  )
);

-- Remove derived daily analytics and citation/competitor aggregates from the old period
-- or from the retired LEGACY dataset.
DELETE FROM public.citations c
WHERE c.project_id IN (
  SELECT id FROM public.projects
  WHERE brand_name IN ('Lifewood Data Technology', 'Dr D Signature Clinic')
)
AND (c.metric_date < DATE '2026-10-15' OR c.tracking_location = 'LEGACY');

DELETE FROM public.competitors c
WHERE c.project_id IN (
  SELECT id FROM public.projects
  WHERE brand_name IN ('Lifewood Data Technology', 'Dr D Signature Clinic')
)
AND (c.metric_date < DATE '2026-10-15' OR c.tracking_location = 'LEGACY');

DELETE FROM public.direct_competitor_observations o
WHERE o.project_id IN (
  SELECT id FROM public.projects
  WHERE brand_name IN ('Lifewood Data Technology', 'Dr D Signature Clinic')
)
AND (o.metric_date < DATE '2026-10-15' OR o.tracking_location = 'LEGACY');

DELETE FROM public.visibility_daily v
WHERE v.project_id IN (
  SELECT id FROM public.projects
  WHERE brand_name IN ('Lifewood Data Technology', 'Dr D Signature Clinic')
)
AND (v.metric_date < DATE '2026-10-15' OR v.tracking_location = 'LEGACY');

-- Remove old and LEGACY runs. Their daily-claim rows are deleted by the existing
-- ON DELETE CASCADE constraint.
DELETE FROM public.tracking_runs tr
WHERE tr.project_id IN (
  SELECT id FROM public.projects
  WHERE brand_name IN ('Lifewood Data Technology', 'Dr D Signature Clinic')
)
AND (
  (tr.started_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date < DATE '2026-10-15'
  OR tr.tracking_location = 'LEGACY'
);

-- Keep only direct competitors with observations on or after the new start date.
-- Rebase their first/last-seen dates so no pre-cutoff discovery history remains.
DELETE FROM public.direct_competitors dc
WHERE dc.project_id IN (
  SELECT id FROM public.projects
  WHERE brand_name IN ('Lifewood Data Technology', 'Dr D Signature Clinic')
)
AND NOT EXISTS (
  SELECT 1
  FROM public.direct_competitor_observations o
  WHERE o.competitor_id = dc.id
    AND o.metric_date >= DATE '2026-10-15'
    AND o.tracking_location <> 'LEGACY'
);

UPDATE public.direct_competitors dc
SET first_seen_date = retained.first_seen_date,
    last_seen_date = retained.last_seen_date
FROM (
  SELECT o.competitor_id, min(o.metric_date) AS first_seen_date, max(o.metric_date) AS last_seen_date
  FROM public.direct_competitor_observations o
  WHERE o.project_id IN (
    SELECT id FROM public.projects
    WHERE brand_name IN ('Lifewood Data Technology', 'Dr D Signature Clinic')
  )
    AND o.metric_date >= DATE '2026-10-15'
    AND o.tracking_location <> 'LEGACY'
  GROUP BY o.competitor_id
) retained
WHERE dc.id = retained.competitor_id;
