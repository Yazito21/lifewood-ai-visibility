-- Persistent, topic-aware direct competitor registry and daily observations.
-- A competitor is never deleted when a later run fails to rediscover it.
CREATE TABLE IF NOT EXISTS public.direct_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic text NOT NULL,
  normalized_domain text NOT NULL,
  brand_name text NOT NULL,
  website text,
  aliases text[] NOT NULL DEFAULT '{}',
  first_seen_date date NOT NULL,
  last_seen_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_competitors_project_topic_domain_key UNIQUE (project_id, topic, normalized_domain)
);

CREATE INDEX IF NOT EXISTS direct_competitors_project_topic_idx
  ON public.direct_competitors (project_id, topic, normalized_domain);

CREATE TABLE IF NOT EXISTS public.direct_competitor_observations (
  competitor_id uuid NOT NULL REFERENCES public.direct_competitors(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  tracking_location text NOT NULL DEFAULT 'LEGACY',
  llm_provider text NOT NULL DEFAULT 'chatgpt',
  presence_count integer NOT NULL DEFAULT 0 CHECK (presence_count >= 0),
  response_count integer NOT NULL DEFAULT 0 CHECK (response_count >= 0),
  citation_count integer NOT NULL DEFAULT 0 CHECK (citation_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competitor_id, metric_date, tracking_location, llm_provider)
);

CREATE INDEX IF NOT EXISTS direct_competitor_observations_period_idx
  ON public.direct_competitor_observations (project_id, metric_date, tracking_location, llm_provider);

ALTER TABLE public.direct_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_competitor_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "direct competitors visible to members" ON public.direct_competitors;
CREATE POLICY "direct competitors visible to members"
  ON public.direct_competitors FOR SELECT TO authenticated
  USING (public.is_project_member(project_id));

DROP POLICY IF EXISTS "direct competitor observations visible to members" ON public.direct_competitor_observations;
CREATE POLICY "direct competitor observations visible to members"
  ON public.direct_competitor_observations FOR SELECT TO authenticated
  USING (public.is_project_member(project_id));

GRANT SELECT ON public.direct_competitors, public.direct_competitor_observations TO authenticated;

-- Return the unique direct-competitor count observed at least once during the selected period.
CREATE OR REPLACE FUNCTION public.get_competitor_counts_for_period(
  p_project_id uuid, p_start_date date, p_end_date date, p_tracking_location text DEFAULT NULL
)
RETURNS TABLE(topic text, metric_date date, competitor_count bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location, p.tracking_market, 'LEGACY') AS location
    FROM public.projects p WHERE p.id = p_project_id
  ),
  latest AS (
    SELECT vd.topic, max(vd.metric_date) AS metric_date
    FROM public.visibility_daily vd CROSS JOIN chosen_location cl
    WHERE vd.project_id = p_project_id AND vd.llm_provider = 'Overall'
      AND vd.tracking_location = cl.location
      AND vd.metric_date BETWEEN p_start_date AND p_end_date
    GROUP BY vd.topic
  ),
  counts AS (
    SELECT dc.topic, max(o.metric_date) AS metric_date,
           count(DISTINCT dc.normalized_domain)::bigint AS competitor_count
    FROM public.direct_competitors dc
    JOIN public.direct_competitor_observations o ON o.competitor_id = dc.id
    CROSS JOIN chosen_location cl
    WHERE dc.project_id = p_project_id
      AND o.project_id = p_project_id
      AND o.tracking_location = cl.location
      AND o.metric_date BETWEEN p_start_date AND p_end_date
      AND o.llm_provider = 'chatgpt'
    GROUP BY dc.topic
  )
  SELECT c.topic, coalesce(l.metric_date, c.metric_date), c.competitor_count
  FROM counts c LEFT JOIN latest l ON l.topic = c.topic;
$$;

-- Rank the tracked brand against the same period-scoped set of direct competitors.
-- Competitor visibility is measured on the latest available day in the selected period;
-- competitors absent from that day's responses receive a score of zero.
CREATE OR REPLACE FUNCTION public.get_direct_competitor_metrics_for_period(
  p_project_id uuid, p_start_date date, p_end_date date, p_tracking_location text DEFAULT NULL
)
RETURNS TABLE(topic text, metric_date date, visibility_rank integer, competitor_count bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location, p.tracking_market, 'LEGACY') AS location
    FROM public.projects p WHERE p.id = p_project_id
  ),
  latest AS (
    SELECT vd.topic, max(vd.metric_date) AS metric_date
    FROM public.visibility_daily vd CROSS JOIN chosen_location cl
    WHERE vd.project_id = p_project_id AND vd.llm_provider = 'Overall'
      AND vd.tracking_location = cl.location
      AND vd.metric_date BETWEEN p_start_date AND p_end_date
    GROUP BY vd.topic
  ),
  brand_scores AS (
    SELECT vd.topic, vd.metric_date, coalesce(vd.visibility_score, 0)::numeric AS brand_score
    FROM public.visibility_daily vd
    JOIN latest l ON l.topic = vd.topic AND l.metric_date = vd.metric_date
    CROSS JOIN chosen_location cl
    WHERE vd.project_id = p_project_id AND vd.llm_provider = 'Overall'
      AND vd.tracking_location = cl.location
  ),
  period_entities AS (
    SELECT DISTINCT dc.id, dc.topic, dc.normalized_domain, l.metric_date
    FROM public.direct_competitors dc
    JOIN public.direct_competitor_observations o ON o.competitor_id = dc.id
    JOIN latest l ON l.topic = dc.topic
    CROSS JOIN chosen_location cl
    WHERE dc.project_id = p_project_id AND o.project_id = p_project_id
      AND o.tracking_location = cl.location AND o.llm_provider = 'chatgpt'
      AND o.metric_date BETWEEN p_start_date AND p_end_date
  ),
  scored AS (
    SELECT pe.topic, pe.metric_date, pe.normalized_domain,
      coalesce(100.0 * latest_obs.presence_count / nullif(latest_obs.response_count, 0), 0)::numeric AS competitor_score
    FROM period_entities pe
    LEFT JOIN public.direct_competitor_observations latest_obs
      ON latest_obs.competitor_id = pe.id
      AND latest_obs.metric_date = pe.metric_date
      AND latest_obs.tracking_location = (SELECT location FROM chosen_location)
      AND latest_obs.llm_provider = 'chatgpt'
  )
  SELECT bs.topic, bs.metric_date,
    (1 + count(s.normalized_domain) FILTER (WHERE s.competitor_score > bs.brand_score))::integer AS visibility_rank,
    count(DISTINCT s.normalized_domain)::bigint AS competitor_count
  FROM brand_scores bs
  LEFT JOIN scored s ON s.topic = bs.topic AND s.metric_date = bs.metric_date
  GROUP BY bs.topic, bs.metric_date, bs.brand_score;
$$;

-- Competitors page now lists only classified direct competitors, deduplicated by domain.
CREATE OR REPLACE FUNCTION public.get_cumulative_competitors(
  p_project_id uuid, p_start_date date, p_end_date date, p_topic text DEFAULT NULL,
  p_engines text[] DEFAULT '{}', p_tracking_location text DEFAULT NULL
)
RETURNS TABLE(brand_name text, website text, visibility_score numeric, citations bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location, p.tracking_market, 'LEGACY') AS location
    FROM public.projects p WHERE p.id = p_project_id
  ),
  selected AS (
    SELECT dc.normalized_domain, max(dc.brand_name) AS brand_name, max(dc.website) AS website,
      avg(100.0 * o.presence_count / nullif(o.response_count, 0))::numeric AS visibility_score,
      sum(o.citation_count)::bigint AS citations
    FROM public.direct_competitors dc
    JOIN public.direct_competitor_observations o ON o.competitor_id = dc.id
    CROSS JOIN chosen_location cl
    WHERE dc.project_id = p_project_id AND o.project_id = p_project_id
      AND o.metric_date BETWEEN p_start_date AND p_end_date
      AND o.tracking_location = cl.location
      AND dc.topic = coalesce(p_topic, 'Overall')
      AND (coalesce(array_length(p_engines, 1), 0) = 0 OR o.llm_provider = ANY(p_engines))
    GROUP BY dc.normalized_domain
  )
  SELECT s.brand_name, 'https://' || s.normalized_domain, s.visibility_score, s.citations
  FROM selected s
  ORDER BY s.citations DESC, s.visibility_score DESC NULLS LAST, s.brand_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_competitor_counts_for_period(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_direct_competitor_metrics_for_period(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cumulative_competitors(uuid, date, date, text, text[], text) TO authenticated;
