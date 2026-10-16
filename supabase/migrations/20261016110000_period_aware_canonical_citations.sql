CREATE OR REPLACE FUNCTION public.canonicalize_citation_url(input_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  without_fragment text;
  base_url text;
  query_string text;
  kept_params text[];
  item text;
  param_key text;
  normalized_base text;
BEGIN
  IF input_url IS NULL OR btrim(input_url) = '' THEN
    RETURN input_url;
  END IF;

  without_fragment := split_part(input_url, '#', 1);
  base_url := split_part(without_fragment, '?', 1);
  query_string := CASE WHEN position('?' IN without_fragment) > 0
    THEN substring(without_fragment FROM position('?' IN without_fragment) + 1)
    ELSE '' END;

  normalized_base := regexp_replace(base_url, '^http://', 'https://', 'i');
  normalized_base := regexp_replace(normalized_base, '^https://www\.', 'https://', 'i');
  normalized_base := regexp_replace(normalized_base, '/+$', '');
  kept_params := ARRAY[]::text[];

  IF query_string <> '' THEN
    FOREACH item IN ARRAY string_to_array(query_string, '&') LOOP
      param_key := lower(split_part(item, '=', 1));
      IF item <> '' AND param_key !~ '^utm_' AND param_key NOT IN (
        'gclid', 'dclid', 'fbclid', 'msclkid', 'yclid', '_ga', '_gl',
        'ref', 'source', 'campaign', 'mc_cid', 'mc_eid'
      ) THEN
        kept_params := array_append(kept_params, item);
      END IF;
    END LOOP;
  END IF;

  IF cardinality(kept_params) > 0 THEN
    SELECT array_agg(value ORDER BY lower(split_part(value, '=', 1)), value)
    INTO kept_params FROM unnest(kept_params) AS value;
    RETURN normalized_base || '?' || array_to_string(kept_params, '&');
  END IF;

  RETURN normalized_base;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cumulative_citations(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_topic text DEFAULT NULL::text,
  p_engines text[] DEFAULT '{}'::text[],
  p_brand_related_only boolean DEFAULT false,
  p_tracking_location text DEFAULT NULL::text
)
RETURNS TABLE(url text, page_name text, brand_name text, frequency bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH normalized AS (
    SELECT c.*,
      public.canonicalize_citation_url(c.url) AS canonical_url
    FROM public.citations c
    WHERE c.project_id = p_project_id
      AND c.metric_date >= p_start_date AND c.metric_date <= p_end_date
      AND c.tracking_location = coalesce(p_tracking_location, (
        SELECT p.tracking_market FROM public.projects p WHERE p.id = p_project_id
      ), 'LEGACY')
      AND (p_topic IS NULL OR c.topic = p_topic)
      AND (coalesce(array_length(p_engines, 1), 0) = 0 OR c.llm_provider = ANY(p_engines))
      AND (NOT p_brand_related_only OR c.is_brand_related = true)
  )
  SELECT n.canonical_url AS url,
         max(n.page_name) AS page_name,
         max(n.brand_name) AS brand_name,
         sum(coalesce(n.frequency, 1))::bigint AS frequency
  FROM normalized n
  GROUP BY n.canonical_url
  ORDER BY sum(coalesce(n.frequency, 1)) DESC, n.canonical_url ASC;
$function$;

CREATE OR REPLACE FUNCTION public.get_cumulative_competitors(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_topic text DEFAULT NULL::text,
  p_engines text[] DEFAULT '{}'::text[],
  p_tracking_location text DEFAULT NULL::text
)
RETURNS TABLE(brand_name text, website text, visibility_score numeric, citations bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH normalized AS (
    SELECT c.*,
      lower(regexp_replace(
        split_part(regexp_replace(coalesce(nullif(c.website, ''), c.brand_name), '^https?://', ''), '/', 1),
        '^www\.', ''
      )) AS normalized_host
    FROM public.competitors c
    WHERE c.project_id = p_project_id
      AND c.metric_date >= p_start_date AND c.metric_date <= p_end_date
      AND c.tracking_location = coalesce(p_tracking_location, (
        SELECT p.tracking_market FROM public.projects p WHERE p.id = p_project_id
      ), 'LEGACY')
      AND (p_topic IS NULL OR c.topic = p_topic)
      AND (coalesce(array_length(p_engines, 1), 0) = 0 OR c.llm_provider = ANY(p_engines))
  )
  SELECT max(n.brand_name) AS brand_name,
         'https://' || n.normalized_host AS website,
         avg(n.visibility_score)::numeric AS visibility_score,
         sum(coalesce(n.citation_count, 0))::bigint AS citations
  FROM normalized n
  WHERE n.normalized_host IS NOT NULL AND n.normalized_host <> ''
  GROUP BY n.normalized_host
  ORDER BY sum(coalesce(n.citation_count, 0)) DESC, avg(n.visibility_score) DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.get_competitor_counts_for_period(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_tracking_location text DEFAULT NULL::text
)
RETURNS TABLE(topic text, metric_date date, competitor_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location, p.tracking_market, 'LEGACY') AS location
    FROM public.projects p WHERE p.id = p_project_id
  ),
  latest AS (
    SELECT vd.topic, max(vd.metric_date) AS metric_date
    FROM public.visibility_daily vd, chosen_location cl
    WHERE vd.project_id = p_project_id
      AND vd.llm_provider = 'Overall'
      AND vd.tracking_location = cl.location
      AND vd.metric_date >= p_start_date AND vd.metric_date <= p_end_date
    GROUP BY vd.topic
  ),
  normalized AS (
    SELECT c.topic, c.metric_date,
      lower(regexp_replace(
        split_part(regexp_replace(coalesce(nullif(c.website, ''), c.brand_name), '^https?://', ''), '/', 1),
        '^www\.', ''
      )) AS host
    FROM public.competitors c
    JOIN latest l ON l.topic = c.topic AND l.metric_date = c.metric_date
    JOIN chosen_location cl ON c.tracking_location = cl.location
    WHERE c.project_id = p_project_id
  )
  SELECT n.topic, n.metric_date, count(DISTINCT n.host)::bigint AS competitor_count
  FROM normalized n
  WHERE n.host IS NOT NULL AND n.host <> ''
  GROUP BY n.topic, n.metric_date;
$function$;
