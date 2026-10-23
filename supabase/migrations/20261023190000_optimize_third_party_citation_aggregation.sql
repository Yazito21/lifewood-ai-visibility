-- Precompute active brand hosts once per project, rather than normalizing
-- the registry through correlated lateral subqueries for every mention row.
CREATE OR REPLACE FUNCTION public.get_third_party_mentions(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_topic text DEFAULT NULL::text,
  p_engines text[] DEFAULT '{}'::text[],
  p_tracking_location text DEFAULT NULL::text
)
RETURNS TABLE(
  hostname text,
  website_name text,
  frequency bigint,
  response_frequency bigint,
  brand_coverage bigint,
  source_types text[],
  example_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
  WITH chosen_location AS MATERIALIZED (
    SELECT coalesce(p_tracking_location, p.tracking_market, 'LEGACY') AS location
    FROM public.projects p
    WHERE p.id = p_project_id
      AND (auth.role() = 'service_role' OR public.is_project_member(p.id))
  ),
  brand_hosts AS MATERIALIZED (
    SELECT DISTINCT
      CASE
        WHEN left(host, 4) = 'www.' THEN substring(host FROM 5)
        ELSE host
      END AS host
    FROM public.brand_registry b
    CROSS JOIN LATERAL unnest(
      coalesce(b.additional_websites, '{}'::text[])
      || ARRAY[coalesce(b.primary_website, '')]
    ) AS raw(raw_site)
    CROSS JOIN LATERAL (
      SELECT lower(split_part(split_part(
        regexp_replace(raw.raw_site, '^https?://', '', 'i'), '/', 1
      ), ':', 1)) AS host
    ) normalized
    WHERE b.project_id = p_project_id
      AND b.is_active
      AND normalized.host <> ''
  ),
  selected AS MATERIALIZED (
    SELECT t.*
    FROM public.third_party_mentions t
    JOIN chosen_location cl ON cl.location = t.tracking_location
    WHERE t.project_id = p_project_id
      AND t.metric_date BETWEEN p_start_date AND p_end_date
      AND (p_topic IS NULL OR t.topic = p_topic)
      AND (coalesce(array_length(p_engines, 1), 0) = 0 OR t.llm_provider = ANY(p_engines))
      AND t.hostname <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM brand_hosts bh
        WHERE t.hostname = bh.host OR t.hostname LIKE '%.' || bh.host
      )
  )
  SELECT
    s.hostname,
    coalesce(max(s.website_name), s.hostname) AS website_name,
    sum(s.frequency)::bigint AS frequency,
    count(DISTINCT s.response_id)::bigint AS response_frequency,
    count(DISTINCT bid)::bigint AS brand_coverage,
    array_agg(DISTINCT s.source_type) AS source_types,
    (array_agg(s.url ORDER BY s.metric_date DESC))[1] AS example_url
  FROM selected s
  LEFT JOIN LATERAL unnest(s.associated_brand_ids) bid ON true
  GROUP BY s.hostname
  ORDER BY count(DISTINCT s.response_id) DESC, sum(s.frequency) DESC, s.hostname;
$function$;
