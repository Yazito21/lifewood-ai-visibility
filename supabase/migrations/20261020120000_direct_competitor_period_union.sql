-- Rank denominators include only direct competitors actually observed in the selected period.
-- Observation rows may exist with zeroes for backfilled days; those zero rows must not expand Y.

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
      AND (o.presence_count > 0 OR o.citation_count > 0)
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
  SELECT bs.topic,
    bs.metric_date,
    (1 + count(s.normalized_domain) FILTER (WHERE s.competitor_score > bs.brand_score))::integer AS visibility_rank,
    count(DISTINCT s.normalized_domain)::bigint AS competitor_count
  FROM brand_scores bs
  LEFT JOIN scored s ON s.topic = bs.topic AND s.metric_date = bs.metric_date
  GROUP BY bs.topic, bs.metric_date, bs.brand_score;
$$;

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
  observed_entities AS (
    SELECT DISTINCT dc.id, dc.normalized_domain
    FROM public.direct_competitors dc
    JOIN public.direct_competitor_observations o ON o.competitor_id = dc.id
    CROSS JOIN chosen_location cl
    WHERE dc.project_id = p_project_id AND o.project_id = p_project_id
      AND o.metric_date BETWEEN p_start_date AND p_end_date
      AND o.tracking_location = cl.location
      AND dc.topic = coalesce(p_topic, 'Overall')
      AND (coalesce(array_length(p_engines, 1), 0) = 0 OR o.llm_provider = ANY(p_engines))
      AND (o.presence_count > 0 OR o.citation_count > 0)
  ),
  selected AS (
    SELECT dc.normalized_domain, max(dc.brand_name) AS brand_name, max(dc.website) AS website,
      avg(100.0 * o.presence_count / nullif(o.response_count, 0))::numeric AS visibility_score,
      sum(o.citation_count)::bigint AS citations
    FROM observed_entities oe
    JOIN public.direct_competitors dc ON dc.id = oe.id
    JOIN public.direct_competitor_observations o ON o.competitor_id = dc.id
    CROSS JOIN chosen_location cl
    WHERE o.metric_date BETWEEN p_start_date AND p_end_date
      AND o.tracking_location = cl.location
      AND (coalesce(array_length(p_engines, 1), 0) = 0 OR o.llm_provider = ANY(p_engines))
    GROUP BY dc.normalized_domain
  )
  SELECT s.brand_name, 'https://' || s.normalized_domain, s.visibility_score, s.citations
  FROM selected s
  ORDER BY s.citations DESC, s.visibility_score DESC NULLS LAST, s.brand_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_direct_competitor_metrics_for_period(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cumulative_competitors(uuid, date, date, text, text[], text) TO authenticated;
