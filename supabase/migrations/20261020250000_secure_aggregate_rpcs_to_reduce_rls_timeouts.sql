-- Avoid repeated RLS membership checks for every row in expensive aggregate RPCs.
-- SECURITY DEFINER is paired with an explicit authenticated project-membership check.
CREATE OR REPLACE FUNCTION public.get_direct_competitor_metrics_for_period(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_tracking_location text DEFAULT NULL
)
RETURNS TABLE(topic text, metric_date date, visibility_rank integer, competitor_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_project_member(p_project_id) THEN
    RAISE EXCEPTION 'Not authorized to access this project' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location, p.tracking_market, 'LEGACY') AS location
    FROM public.projects p
    WHERE p.id = p_project_id
  ),
  latest AS (
    SELECT vd.topic, max(vd.metric_date) AS metric_date
    FROM public.visibility_daily vd
    CROSS JOIN chosen_location cl
    WHERE vd.project_id = p_project_id
      AND vd.llm_provider = 'Overall'
      AND vd.tracking_location = cl.location
      AND vd.metric_date BETWEEN p_start_date AND p_end_date
    GROUP BY vd.topic
  ),
  brand_scores AS (
    SELECT vd.topic, vd.metric_date,
           coalesce(vd.visibility_score, 0)::numeric AS brand_score,
           coalesce(obs.response_count, 0)::integer AS response_count
    FROM public.visibility_daily vd
    JOIN latest l ON l.topic = vd.topic AND l.metric_date = vd.metric_date
    CROSS JOIN chosen_location cl
    LEFT JOIN LATERAL (
      SELECT max(o.response_count) AS response_count
      FROM public.direct_competitors dc
      JOIN public.direct_competitor_observations o
        ON o.competitor_id = dc.id
       AND o.project_id = p_project_id
       AND o.metric_date = vd.metric_date
       AND o.tracking_location = cl.location
       AND o.llm_provider = 'chatgpt'
      WHERE dc.project_id = p_project_id AND dc.topic = vd.topic
    ) obs ON true
    WHERE vd.project_id = p_project_id
      AND vd.llm_provider = 'Overall'
      AND vd.tracking_location = cl.location
  ),
  period_entities AS (
    SELECT DISTINCT dc.id, dc.topic, dc.normalized_domain, l.metric_date
    FROM public.direct_competitors dc
    JOIN public.direct_competitor_observations o
      ON o.competitor_id = dc.id AND o.project_id = p_project_id
    JOIN latest l ON l.topic = dc.topic
    CROSS JOIN chosen_location cl
    WHERE dc.project_id = p_project_id
      AND o.tracking_location = cl.location
      AND o.llm_provider = 'chatgpt'
      AND o.metric_date BETWEEN p_start_date AND p_end_date
      AND (o.presence_count > 0 OR o.citation_count > 0)
  ),
  scored AS (
    SELECT pe.topic, pe.metric_date, pe.normalized_domain,
           coalesce(latest_obs.presence_count, 0)::integer AS competitor_mentions
    FROM period_entities pe
    LEFT JOIN public.direct_competitor_observations latest_obs
      ON latest_obs.competitor_id = pe.id
     AND latest_obs.project_id = p_project_id
     AND latest_obs.metric_date = pe.metric_date
     AND latest_obs.tracking_location = (SELECT location FROM chosen_location)
     AND latest_obs.llm_provider = 'chatgpt'
  ),
  ranked AS (
    SELECT bs.topic, bs.metric_date,
      count(DISTINCT s.normalized_domain)::bigint AS direct_competitor_count,
      count(DISTINCT s.normalized_domain) FILTER (
        WHERE s.competitor_mentions > round(bs.brand_score * bs.response_count / 100.0)
      )::bigint AS competitors_above
    FROM brand_scores bs
    LEFT JOIN scored s ON s.topic = bs.topic AND s.metric_date = bs.metric_date
    GROUP BY bs.topic, bs.metric_date, bs.brand_score, bs.response_count
  )
  SELECT r.topic, r.metric_date,
    CASE WHEN r.direct_competitor_count = 0 THEN 1
         ELSE least(1 + r.competitors_above, r.direct_competitor_count + 1)::integer
    END,
    (r.direct_competitor_count + 1)::bigint
  FROM ranked r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cumulative_citations(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_topic text DEFAULT NULL,
  p_engines text[] DEFAULT '{}',
  p_brand_related_only boolean DEFAULT false,
  p_tracking_location text DEFAULT NULL
)
RETURNS TABLE(url text, page_name text, brand_name text, frequency bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_project_member(p_project_id) THEN
    RAISE EXCEPTION 'Not authorized to access this project' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH normalized AS (
    SELECT c.url, c.page_name, c.brand_name, c.frequency,
           public.canonicalize_citation_url(c.url) AS canonical_url
    FROM public.citations c
    WHERE c.project_id = p_project_id
      AND c.metric_date BETWEEN p_start_date AND p_end_date
      AND c.tracking_location = coalesce(p_tracking_location, (
        SELECT p.tracking_market FROM public.projects p WHERE p.id = p_project_id
      ), 'LEGACY')
      AND (p_topic IS NULL OR c.topic = p_topic)
      AND (coalesce(array_length(p_engines, 1), 0) = 0 OR c.llm_provider = ANY(p_engines))
      AND (NOT p_brand_related_only OR c.is_brand_related = true)
  )
  SELECT n.canonical_url, max(n.page_name), max(n.brand_name),
         sum(coalesce(n.frequency, 1))::bigint
  FROM normalized n
  GROUP BY n.canonical_url
  ORDER BY sum(coalesce(n.frequency, 1)) DESC, n.canonical_url ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_direct_competitor_metrics_for_period(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_direct_competitor_metrics_for_period(uuid,date,date,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_cumulative_citations(uuid,date,date,text,text[],boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cumulative_citations(uuid,date,date,text,text[],boolean,text) TO authenticated, service_role;
