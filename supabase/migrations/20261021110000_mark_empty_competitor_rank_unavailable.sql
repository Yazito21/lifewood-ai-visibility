-- Do not represent an empty direct-competitor registry as a valid first-place rank.
-- A rank is unavailable until at least one direct competitor is verified in-period.
CREATE OR REPLACE FUNCTION public.get_direct_competitor_metrics_for_period(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_tracking_location text DEFAULT NULL::text
)
RETURNS TABLE(topic text, metric_date date, visibility_rank integer, competitor_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
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
           coalesce((
             SELECT max(o.response_count)
             FROM public.direct_competitors dc
             JOIN public.direct_competitor_observations o
               ON o.competitor_id = dc.id
              AND o.project_id = vd.project_id
              AND o.metric_date = vd.metric_date
              AND o.tracking_location = cl.location
              AND o.llm_provider = 'chatgpt'
             WHERE dc.project_id = vd.project_id
               AND dc.topic = vd.topic
           ), 0)::integer AS response_count
    FROM public.visibility_daily vd
    JOIN latest l ON l.topic = vd.topic AND l.metric_date = vd.metric_date
    CROSS JOIN chosen_location cl
    WHERE vd.project_id = p_project_id
      AND vd.llm_provider = 'Overall'
      AND vd.tracking_location = cl.location
  ),
  period_entities AS (
    SELECT DISTINCT dc.id, dc.topic, dc.normalized_domain, l.metric_date
    FROM public.direct_competitors dc
    JOIN public.direct_competitor_observations o ON o.competitor_id = dc.id
    JOIN latest l ON l.topic = dc.topic
    CROSS JOIN chosen_location cl
    WHERE dc.project_id = p_project_id
      AND o.project_id = p_project_id
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
    CASE WHEN r.direct_competitor_count = 0 THEN NULL::integer
         ELSE least(1 + r.competitors_above, r.direct_competitor_count + 1)::integer
    END AS visibility_rank,
    CASE WHEN r.direct_competitor_count = 0 THEN 0::bigint
         ELSE (r.direct_competitor_count + 1)::bigint
    END AS competitor_count
  FROM ranked r;
$function$;

GRANT EXECUTE ON FUNCTION public.get_direct_competitor_metrics_for_period(uuid, date, date, text) TO authenticated;

-- Correct historical dashboard points that were previously stored as rank 1
-- despite having no direct-competitor observations for that topic/date/location.
UPDATE public.visibility_daily vd
SET visibility_rank = NULL
WHERE vd.llm_provider = 'Overall'
  AND NOT EXISTS (
    SELECT 1
    FROM public.direct_competitors dc
    JOIN public.direct_competitor_observations o
      ON o.competitor_id = dc.id
     AND o.project_id = vd.project_id
     AND o.metric_date = vd.metric_date
     AND o.tracking_location = vd.tracking_location
     AND o.llm_provider = 'chatgpt'
    WHERE dc.project_id = vd.project_id
      AND dc.topic = vd.topic
      AND (o.presence_count > 0 OR o.citation_count > 0)
  );
