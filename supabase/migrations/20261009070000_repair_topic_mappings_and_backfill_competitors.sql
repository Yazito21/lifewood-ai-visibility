-- Align prompt and metric topic names with the labels used by the project filters.
UPDATE public.prompts SET topic = CASE topic
  WHEN 'AI data collection services' THEN 'Global multilingual AI data collection services'
  WHEN 'AI data annotation and labelling services' THEN 'Large-scale AI data annotation & labelling'
  WHEN 'AI-generated content production services' THEN 'AI-generated content production (AIGC)'
  WHEN 'AEO and GEO services' THEN 'AEO & GEO services'
  ELSE topic END
WHERE project_id = '2f24625f-b7f8-404e-b63f-5acec1004711'
  AND topic IN ('AI data collection services','AI data annotation and labelling services','AI-generated content production services','AEO and GEO services');

UPDATE public.citations SET topic = CASE topic
  WHEN 'AI data collection services' THEN 'Global multilingual AI data collection services'
  WHEN 'AI data annotation and labelling services' THEN 'Large-scale AI data annotation & labelling'
  WHEN 'AI-generated content production services' THEN 'AI-generated content production (AIGC)'
  WHEN 'AEO and GEO services' THEN 'AEO & GEO services'
  ELSE topic END
WHERE project_id = '2f24625f-b7f8-404e-b63f-5acec1004711'
  AND topic IN ('AI data collection services','AI data annotation and labelling services','AI-generated content production services','AEO and GEO services');

UPDATE public.visibility_daily SET topic = CASE topic
  WHEN 'AI data collection services' THEN 'Global multilingual AI data collection services'
  WHEN 'AI data annotation and labelling services' THEN 'Large-scale AI data annotation & labelling'
  WHEN 'AI-generated content production services' THEN 'AI-generated content production (AIGC)'
  WHEN 'AEO and GEO services' THEN 'AEO & GEO services'
  ELSE topic END
WHERE project_id = '2f24625f-b7f8-404e-b63f-5acec1004711'
  AND topic IN ('AI data collection services','AI data annotation and labelling services','AI-generated content production services','AEO and GEO services');

-- Reconstruct topic-level competitor metrics from completed raw responses.
WITH raw_urls AS (
  SELECT ar.prompt_id, p.topic, (ar.captured_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS metric_date,
         s.value->>'url' AS url
  FROM public.ai_responses ar
  JOIN public.prompts p ON p.id = ar.prompt_id
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(ar.raw_response->'output','[]'::jsonb)) o(value)
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.value->'action'->'sources','[]'::jsonb)) s(value)
  WHERE ar.project_id = '2f24625f-b7f8-404e-b63f-5acec1004711' AND ar.response_status = 'completed'
  UNION
  SELECT ar.prompt_id, p.topic, (ar.captured_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS metric_date,
         a.value->>'url' AS url
  FROM public.ai_responses ar
  JOIN public.prompts p ON p.id = ar.prompt_id
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(ar.raw_response->'output','[]'::jsonb)) o(value)
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.value->'content','[]'::jsonb)) c(value)
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.value->'annotations','[]'::jsonb)) a(value)
  WHERE ar.project_id = '2f24625f-b7f8-404e-b63f-5acec1004711' AND ar.response_status = 'completed'
),
hosts AS (
  SELECT DISTINCT prompt_id, topic, metric_date,
    lower(regexp_replace(split_part(regexp_replace(url,'^https?://','', 'i'), '/', 1), '^www\\.', '', 'i')) AS host
  FROM raw_urls WHERE url ~* '^https?://'
),
valid_hosts AS (
  SELECT h.* FROM hosts h
  WHERE h.host <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.projects pr,
           LATERAL unnest(coalesce(pr.brand_domains, ARRAY[]::text[])) d(domain)
      WHERE pr.id = '2f24625f-b7f8-404e-b63f-5acec1004711'
        AND (regexp_replace(lower(d.domain), '^https?://(www\\.)?', '', 'i') = h.host
          OR h.host LIKE '%.' || regexp_replace(lower(d.domain), '^https?://(www\\.)?', '', 'i'))
    )
),
topic_totals AS (
  SELECT p.topic, (ar.captured_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS metric_date,
         count(DISTINCT ar.prompt_id)::numeric AS prompt_total
  FROM public.ai_responses ar JOIN public.prompts p ON p.id = ar.prompt_id
  WHERE ar.project_id = '2f24625f-b7f8-404e-b63f-5acec1004711' AND ar.response_status = 'completed'
  GROUP BY p.topic, (ar.captured_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
),
host_counts AS (
  SELECT topic, metric_date, host, count(DISTINCT prompt_id)::integer AS prompt_count
  FROM valid_hosts GROUP BY topic, metric_date, host
)
INSERT INTO public.competitors
  (project_id, metric_date, topic, llm_provider, brand_name, website, visibility_score, citation_count)
SELECT '2f24625f-b7f8-404e-b63f-5acec1004711'::uuid,
       h.metric_date, h.topic, 'chatgpt', h.host, 'https://' || h.host,
       round(100.0 * h.prompt_count / nullif(t.prompt_total,0), 1), h.prompt_count
FROM host_counts h JOIN topic_totals t ON t.topic = h.topic AND t.metric_date = h.metric_date
ON CONFLICT (project_id, metric_date, topic, llm_provider, brand_name)
DO UPDATE SET website = EXCLUDED.website,
              visibility_score = EXCLUDED.visibility_score,
              citation_count = EXCLUDED.citation_count;
