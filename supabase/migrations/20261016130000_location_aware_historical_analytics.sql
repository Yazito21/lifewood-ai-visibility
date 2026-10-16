-- Preserve historical rows as a separate legacy dataset and tag new data by tracking location.
ALTER TABLE public.tracking_runs ADD COLUMN IF NOT EXISTS tracking_location text;
ALTER TABLE public.citations ADD COLUMN IF NOT EXISTS tracking_location text;
ALTER TABLE public.competitors ADD COLUMN IF NOT EXISTS tracking_location text;
ALTER TABLE public.visibility_daily ADD COLUMN IF NOT EXISTS tracking_location text;

-- The old records were collected before reliable run-level location tracking existed.
-- Do not infer their location from the project's current setting.
UPDATE public.tracking_runs SET tracking_location = 'LEGACY' WHERE tracking_location IS NULL;
UPDATE public.ai_responses SET tracking_location = 'LEGACY' WHERE tracking_location IS NULL;
UPDATE public.citations SET tracking_location = 'LEGACY' WHERE tracking_location IS NULL;
UPDATE public.competitors SET tracking_location = 'LEGACY' WHERE tracking_location IS NULL;
UPDATE public.visibility_daily SET tracking_location = 'LEGACY' WHERE tracking_location IS NULL;

ALTER TABLE public.tracking_runs ALTER COLUMN tracking_location SET DEFAULT 'LEGACY';
ALTER TABLE public.citations ALTER COLUMN tracking_location SET DEFAULT 'LEGACY';
ALTER TABLE public.competitors ALTER COLUMN tracking_location SET DEFAULT 'LEGACY';
ALTER TABLE public.visibility_daily ALTER COLUMN tracking_location SET DEFAULT 'LEGACY';

ALTER TABLE public.tracking_runs DROP CONSTRAINT IF EXISTS tracking_runs_tracking_location_check;
ALTER TABLE public.tracking_runs ADD CONSTRAINT tracking_runs_tracking_location_check
  CHECK (tracking_location = 'LEGACY' OR tracking_location = 'GLOBAL' OR tracking_location ~ '^[A-Z]{2}$');
ALTER TABLE public.ai_responses DROP CONSTRAINT IF EXISTS ai_responses_tracking_location_check;
ALTER TABLE public.ai_responses ADD CONSTRAINT ai_responses_tracking_location_check
  CHECK (tracking_location = 'LEGACY' OR tracking_location = 'GLOBAL' OR tracking_location ~ '^[A-Z]{2}$');
ALTER TABLE public.citations DROP CONSTRAINT IF EXISTS citations_tracking_location_check;
ALTER TABLE public.citations ADD CONSTRAINT citations_tracking_location_check
  CHECK (tracking_location = 'LEGACY' OR tracking_location = 'GLOBAL' OR tracking_location ~ '^[A-Z]{2}$');
ALTER TABLE public.competitors DROP CONSTRAINT IF EXISTS competitors_tracking_location_check;
ALTER TABLE public.competitors ADD CONSTRAINT competitors_tracking_location_check
  CHECK (tracking_location = 'LEGACY' OR tracking_location = 'GLOBAL' OR tracking_location ~ '^[A-Z]{2}$');
ALTER TABLE public.visibility_daily DROP CONSTRAINT IF EXISTS visibility_daily_tracking_location_check;
ALTER TABLE public.visibility_daily ADD CONSTRAINT visibility_daily_tracking_location_check
  CHECK (tracking_location = 'LEGACY' OR tracking_location = 'GLOBAL' OR tracking_location ~ '^[A-Z]{2}$');

-- Include location in daily natural keys so a legacy row and a new location-specific
-- row can coexist on the same date without overwriting one another.
DROP INDEX IF EXISTS public.citations_daily_url_unique_idx;
CREATE UNIQUE INDEX citations_daily_url_location_unique_idx
  ON public.citations (project_id, metric_date, topic, llm_provider, url, tracking_location);
DROP INDEX IF EXISTS public.competitors_daily_brand_unique_idx;
CREATE UNIQUE INDEX competitors_daily_brand_location_unique_idx
  ON public.competitors (project_id, metric_date, topic, llm_provider, brand_name, tracking_location);
DROP INDEX IF EXISTS public.visibility_daily_project_id_metric_date_topic_llm_provider_key;
CREATE UNIQUE INDEX visibility_daily_project_date_topic_engine_location_key
  ON public.visibility_daily (project_id, metric_date, topic, llm_provider, tracking_location);

CREATE INDEX IF NOT EXISTS citations_project_location_date_idx
  ON public.citations (project_id, tracking_location, metric_date DESC);
CREATE INDEX IF NOT EXISTS competitors_project_location_date_idx
  ON public.competitors (project_id, tracking_location, metric_date DESC);
CREATE INDEX IF NOT EXISTS visibility_daily_project_location_date_idx
  ON public.visibility_daily (project_id, tracking_location, metric_date DESC);
CREATE INDEX IF NOT EXISTS tracking_runs_project_location_started_idx
  ON public.tracking_runs (project_id, tracking_location, started_at DESC);

COMMENT ON COLUMN public.tracking_runs.tracking_location IS 'Immutable country code or GLOBAL used by this run; LEGACY means location was not reliably recorded.';
COMMENT ON COLUMN public.ai_responses.tracking_location IS 'Country code or GLOBAL used for this response; LEGACY means location was not reliably recorded.';
COMMENT ON COLUMN public.citations.tracking_location IS 'Country code or GLOBAL for the originating tracking data; LEGACY means location was not reliably recorded.';
COMMENT ON COLUMN public.competitors.tracking_location IS 'Country code or GLOBAL for the originating tracking data; LEGACY means location was not reliably recorded.';
COMMENT ON COLUMN public.visibility_daily.tracking_location IS 'Country code or GLOBAL for the originating metrics; LEGACY means location was not reliably recorded.';

CREATE OR REPLACE FUNCTION public.get_cumulative_citations(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_topic text DEFAULT NULL,
  p_engines text[] DEFAULT '{}'::text[],
  p_brand_related_only boolean DEFAULT false,
  p_tracking_location text DEFAULT NULL
)
RETURNS TABLE (url text, page_name text, brand_name text, frequency bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT c.url, max(c.page_name) AS page_name, max(c.brand_name) AS brand_name,
         sum(coalesce(c.frequency, 1))::bigint AS frequency
  FROM public.citations c
  WHERE c.project_id = p_project_id
    AND c.metric_date >= p_start_date AND c.metric_date <= p_end_date
    AND c.tracking_location = coalesce(p_tracking_location, (
      SELECT p.tracking_market FROM public.projects p WHERE p.id = p_project_id
    ), 'LEGACY')
    AND (p_topic IS NULL OR c.topic = p_topic)
    AND (coalesce(array_length(p_engines, 1), 0) = 0 OR c.llm_provider = ANY(p_engines))
    AND (NOT p_brand_related_only OR c.is_brand_related = true)
  GROUP BY c.url
  ORDER BY sum(coalesce(c.frequency, 1)) DESC, c.url ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_cumulative_competitors(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_topic text DEFAULT NULL,
  p_engines text[] DEFAULT '{}'::text[],
  p_tracking_location text DEFAULT NULL
)
RETURNS TABLE (brand_name text, website text, visibility_score numeric, citations bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT c.brand_name, max(c.website) AS website,
         avg(c.visibility_score)::numeric AS visibility_score,
         sum(coalesce(c.citation_count, 0))::bigint AS citations
  FROM public.competitors c
  WHERE c.project_id = p_project_id
    AND c.metric_date >= p_start_date AND c.metric_date <= p_end_date
    AND c.tracking_location = coalesce(p_tracking_location, (
      SELECT p.tracking_market FROM public.projects p WHERE p.id = p_project_id
    ), 'LEGACY')
    AND (p_topic IS NULL OR c.topic = p_topic)
    AND (coalesce(array_length(p_engines, 1), 0) = 0 OR c.llm_provider = ANY(p_engines))
    AND lower(regexp_replace(coalesce(c.brand_name, ''), '^www\\.', '')) not in (
      'google.com', 'google.co.uk', 'google.ca', 'google.com.au', 'google.co.in',
      'googleusercontent.com', 'gstatic.com', 'googleapis.com', 'bing.com',
      'search.yahoo.com', 'yahoo.com', 'duckduckgo.com', 'wikipedia.org',
      'en.wikipedia.org', 'facebook.com', 'instagram.com', 'youtube.com',
      'tiktok.com', 'x.com', 'twitter.com', 'linkedin.com', 'reddit.com',
      'goodfirms.co', 'clutch.co'
    )
  GROUP BY c.brand_name
  ORDER BY sum(coalesce(c.citation_count, 0)) DESC, avg(c.visibility_score) DESC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.get_latest_competitor_counts(
  p_project_id uuid,
  p_tracking_location text DEFAULT NULL
)
RETURNS TABLE (topic text, metric_date date, competitor_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location, p.tracking_market, 'LEGACY') AS location
    FROM public.projects p WHERE p.id = p_project_id
  ), latest AS (
    SELECT vd.topic, max(vd.metric_date) AS metric_date
    FROM public.visibility_daily vd, chosen_location cl
    WHERE vd.project_id = p_project_id AND vd.llm_provider = 'Overall'
      AND vd.tracking_location = cl.location
    GROUP BY vd.topic
  )
  SELECT c.topic, c.metric_date, count(DISTINCT c.brand_name)::bigint AS competitor_count
  FROM public.competitors c
  JOIN latest l ON l.topic = c.topic AND l.metric_date = c.metric_date
  JOIN chosen_location cl ON c.tracking_location = cl.location
  WHERE c.project_id = p_project_id
    AND lower(regexp_replace(coalesce(c.brand_name, ''), '^www\\.', '')) not in (
      'google.com', 'google.co.uk', 'google.ca', 'google.com.au', 'google.co.in',
      'googleusercontent.com', 'gstatic.com', 'googleapis.com', 'bing.com',
      'search.yahoo.com', 'yahoo.com', 'duckduckgo.com', 'wikipedia.org',
      'en.wikipedia.org', 'facebook.com', 'instagram.com', 'youtube.com',
      'tiktok.com', 'x.com', 'twitter.com', 'linkedin.com', 'reddit.com',
      'goodfirms.co', 'clutch.co'
    )
  GROUP BY c.topic, c.metric_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_cumulative_citations(uuid, date, date, text, text[], boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cumulative_competitors(uuid, date, date, text, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_competitor_counts(uuid, text) TO authenticated;
