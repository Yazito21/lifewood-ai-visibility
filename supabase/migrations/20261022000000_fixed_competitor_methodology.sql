-- Fixed topic-specific brand registry, response evidence and third-party mention analysis.
-- Additive migration: never rewrites or deletes raw AI response payloads.
CREATE TABLE IF NOT EXISTS public.brand_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  canonical_name text NOT NULL,
  normalized_key text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  primary_website text,
  additional_websites text[] NOT NULL DEFAULT '{}',
  is_tracked_brand boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_registry_project_normalized_key_key UNIQUE(project_id, normalized_key)
);
CREATE INDEX IF NOT EXISTS brand_registry_project_active_idx ON public.brand_registry(project_id,is_active);

CREATE TABLE IF NOT EXISTS public.topic_brand_assignments (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic text NOT NULL,
  brand_id uuid NOT NULL REFERENCES public.brand_registry(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'competitor' CHECK (role IN ('tracked_brand','competitor')),
  aliases text[] NOT NULL DEFAULT '{}',
  websites text[] NOT NULL DEFAULT '{}',
  include_in_metrics boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,topic,brand_id)
);
CREATE INDEX IF NOT EXISTS topic_brand_assignments_lookup_idx ON public.topic_brand_assignments(project_id,topic,include_in_metrics);

CREATE TABLE IF NOT EXISTS public.topic_brand_observations (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brand_registry(id) ON DELETE CASCADE,
  topic text NOT NULL,
  metric_date date NOT NULL,
  tracking_location text NOT NULL DEFAULT 'LEGACY',
  llm_provider text NOT NULL DEFAULT 'chatgpt',
  presence_count integer NOT NULL DEFAULT 0 CHECK (presence_count >= 0),
  response_count integer NOT NULL DEFAULT 0 CHECK (response_count >= 0),
  mention_count integer NOT NULL DEFAULT 0 CHECK (mention_count >= 0),
  citation_count integer NOT NULL DEFAULT 0 CHECK (citation_count >= 0),
  average_position numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,brand_id,topic,metric_date,tracking_location,llm_provider)
);
CREATE INDEX IF NOT EXISTS topic_brand_observations_period_idx ON public.topic_brand_observations(project_id,topic,metric_date,tracking_location,llm_provider);

CREATE TABLE IF NOT EXISTS public.response_brand_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  response_id uuid NOT NULL REFERENCES public.ai_responses(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brand_registry(id) ON DELETE CASCADE,
  topic text NOT NULL,
  match_source text NOT NULL CHECK(match_source IN ('response_text','citation_domain','research_source','mentioned_url')),
  matched_value text NOT NULL,
  evidence_text text,
  first_position integer,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK(occurrence_count >= 0),
  confidence text NOT NULL DEFAULT 'deterministic' CHECK(confidence IN ('deterministic','review_required','verified')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(response_id,brand_id,topic,match_source,matched_value)
);
CREATE INDEX IF NOT EXISTS response_brand_evidence_project_topic_idx ON public.response_brand_evidence(project_id,topic,brand_id);
CREATE INDEX IF NOT EXISTS response_brand_evidence_response_idx ON public.response_brand_evidence(response_id);

CREATE TABLE IF NOT EXISTS public.third_party_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  response_id uuid REFERENCES public.ai_responses(id) ON DELETE SET NULL,
  metric_date date NOT NULL,
  topic text NOT NULL,
  llm_provider text NOT NULL,
  tracking_location text NOT NULL DEFAULT 'LEGACY',
  url text NOT NULL,
  canonical_url text NOT NULL,
  hostname text NOT NULL,
  website_name text,
  source_type text NOT NULL CHECK(source_type IN ('citation_annotation','research_source','mentioned_url')),
  associated_brand_ids uuid[] NOT NULL DEFAULT '{}',
  associated_brand_names text[] NOT NULL DEFAULT '{}',
  association_status text NOT NULL DEFAULT 'unverified' CHECK(association_status IN ('verified','inferred','unverified')),
  frequency integer NOT NULL DEFAULT 1 CHECK(frequency >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,response_id,canonical_url,source_type,topic,tracking_location)
);
CREATE INDEX IF NOT EXISTS third_party_mentions_period_idx ON public.third_party_mentions(project_id,metric_date,topic,llm_provider,tracking_location);
CREATE INDEX IF NOT EXISTS third_party_mentions_host_idx ON public.third_party_mentions(project_id,hostname);

ALTER TABLE public.brand_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topic_brand_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topic_brand_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.response_brand_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.third_party_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand registry visible to members" ON public.brand_registry;
CREATE POLICY "brand registry visible to members" ON public.brand_registry FOR SELECT TO authenticated USING(public.is_project_member(project_id));
DROP POLICY IF EXISTS "brand registry editable by admins" ON public.brand_registry;
CREATE POLICY "brand registry editable by admins" ON public.brand_registry FOR ALL TO authenticated USING(public.can_edit_project(project_id)) WITH CHECK(public.can_edit_project(project_id));
DROP POLICY IF EXISTS "topic assignments visible to members" ON public.topic_brand_assignments;
CREATE POLICY "topic assignments visible to members" ON public.topic_brand_assignments FOR SELECT TO authenticated USING(public.is_project_member(project_id));
DROP POLICY IF EXISTS "topic assignments editable by admins" ON public.topic_brand_assignments;
CREATE POLICY "topic assignments editable by admins" ON public.topic_brand_assignments FOR ALL TO authenticated USING(public.can_edit_project(project_id)) WITH CHECK(public.can_edit_project(project_id));
DROP POLICY IF EXISTS "topic brand observations visible to members" ON public.topic_brand_observations;
CREATE POLICY "topic brand observations visible to members" ON public.topic_brand_observations FOR SELECT TO authenticated USING(public.is_project_member(project_id));
DROP POLICY IF EXISTS "response brand evidence visible to members" ON public.response_brand_evidence;
CREATE POLICY "response brand evidence visible to members" ON public.response_brand_evidence FOR SELECT TO authenticated USING(public.is_project_member(project_id));
DROP POLICY IF EXISTS "third-party mentions visible to members" ON public.third_party_mentions;
CREATE POLICY "third-party mentions visible to members" ON public.third_party_mentions FOR SELECT TO authenticated USING(public.is_project_member(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_registry, public.topic_brand_assignments TO authenticated;
GRANT SELECT ON public.topic_brand_observations, public.response_brand_evidence, public.third_party_mentions TO authenticated;
GRANT ALL ON public.topic_brand_observations, public.response_brand_evidence, public.third_party_mentions TO service_role;

CREATE OR REPLACE FUNCTION public.get_third_party_mentions(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_topic text DEFAULT NULL,
  p_engines text[] DEFAULT '{}',
  p_tracking_location text DEFAULT NULL
)
RETURNS TABLE(hostname text, website_name text, frequency bigint, response_frequency bigint, brand_coverage bigint, source_types text[], example_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location,p.tracking_market,'LEGACY') AS location
    FROM public.projects p WHERE p.id=p_project_id
  ),
  selected AS (
    SELECT t.*
    FROM public.third_party_mentions t
    CROSS JOIN chosen_location cl
    WHERE t.project_id=p_project_id
      AND t.metric_date BETWEEN p_start_date AND p_end_date
      AND t.tracking_location=cl.location
      AND (p_topic IS NULL OR t.topic=p_topic)
      AND (coalesce(array_length(p_engines,1),0)=0 OR t.llm_provider=ANY(p_engines))
      AND t.hostname <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.brand_registry b
        WHERE b.project_id=t.project_id
          AND EXISTS (
            SELECT 1 FROM unnest(coalesce(b.additional_websites,'{}') || ARRAY[coalesce(b.primary_website,'')]) raw_site
            CROSS JOIN LATERAL (
              SELECT lower(regexp_replace(split_part(regexp_replace(regexp_replace(raw_site,'^https?://','','i'),'^www\.','','i'), '/', 1),'[.]$','')) AS host
            ) normalized
            WHERE normalized.host <> ''
              AND (t.hostname=normalized.host OR t.hostname LIKE '%.'||normalized.host)
          )
      )
  )
  SELECT s.hostname,
    coalesce(max(s.website_name),s.hostname) AS website_name,
    sum(s.frequency)::bigint AS frequency,
    count(DISTINCT s.response_id)::bigint AS response_frequency,
    count(DISTINCT bid)::bigint AS brand_coverage,
    array_agg(DISTINCT s.source_type) AS source_types,
    (array_agg(s.url ORDER BY s.metric_date DESC))[1] AS example_url
  FROM selected s
  LEFT JOIN LATERAL unnest(s.associated_brand_ids) bid ON true
  GROUP BY s.hostname
  ORDER BY count(DISTINCT s.response_id) DESC, sum(s.frequency) DESC, s.hostname;
$$;
REVOKE ALL ON FUNCTION public.get_third_party_mentions(uuid,date,date,text,text[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_third_party_mentions(uuid,date,date,text,text[],text) TO authenticated, service_role;


-- Backfill the new canonical directory from the existing project identity and legacy
-- direct-competitor registry. The legacy source tables and raw responses are retained.
INSERT INTO public.brand_registry (
  project_id, canonical_name, normalized_key, aliases, primary_website, additional_websites,
  is_tracked_brand, is_active, updated_at
)
SELECT p.id, p.brand_name,
  regexp_replace(lower(trim(p.brand_name)), '[^a-z0-9]+', '', 'g'),
  coalesce(p.brand_terms, '{}'::text[]),
  nullif(split_part(regexp_replace(regexp_replace(coalesce(p.brand_domains[1], ''), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/', 1), ''),
  coalesce(ARRAY(SELECT x FROM unnest(coalesce(p.brand_domains, '{}'::text[])[2:]) x WHERE btrim(x) <> ''), '{}'::text[]),
  true, true, now()
FROM public.projects p
WHERE nullif(regexp_replace(lower(trim(p.brand_name)), '[^a-z0-9]+', '', 'g'), '') IS NOT NULL
ON CONFLICT (project_id, normalized_key) DO UPDATE SET
  is_tracked_brand = true,
  aliases = ARRAY(SELECT DISTINCT v FROM unnest(coalesce(public.brand_registry.aliases,'{}') || EXCLUDED.aliases) v WHERE btrim(v) <> ''),
  primary_website = coalesce(public.brand_registry.primary_website, EXCLUDED.primary_website),
  additional_websites = ARRAY(SELECT DISTINCT v FROM unnest(coalesce(public.brand_registry.additional_websites,'{}') || EXCLUDED.additional_websites) v WHERE btrim(v) <> ''),
  updated_at = now();

WITH legacy_brands AS (
  SELECT d.project_id,
    min(nullif(btrim(d.brand_name),'')) AS canonical_name,
    regexp_replace(lower(trim(min(d.brand_name))), '[^a-z0-9]+', '', 'g') AS normalized_key,
    array_agg(DISTINCT alias.value) FILTER (WHERE btrim(alias.value) <> '') AS aliases,
    min(nullif(d.website,'')) AS website
  FROM public.direct_competitors d
  CROSS JOIN LATERAL unnest(
    coalesce(d.aliases, '{}'::text[]) || ARRAY[coalesce(d.brand_name,''),coalesce(d.normalized_domain,'')]
  ) AS alias(value)
  JOIN public.projects p ON p.id=d.project_id
  WHERE d.topic <> 'Overall'
    AND nullif(regexp_replace(lower(trim(d.brand_name)), '[^a-z0-9]+', '', 'g'), '') IS NOT NULL
    AND regexp_replace(lower(trim(d.brand_name)), '[^a-z0-9]+', '', 'g')
      <> regexp_replace(lower(trim(p.brand_name)), '[^a-z0-9]+', '', 'g')
  GROUP BY d.project_id, regexp_replace(lower(trim(d.brand_name)), '[^a-z0-9]+', '', 'g')
)
INSERT INTO public.brand_registry (
  project_id, canonical_name, normalized_key, aliases, primary_website,
  additional_websites, is_tracked_brand, is_active, updated_at
)
SELECT project_id, canonical_name, normalized_key, coalesce(aliases,'{}'::text[]),
  nullif(split_part(regexp_replace(regexp_replace(coalesce(website,''), '^https?://','','i'), '^www[.]','','i'), '/', 1),''),
  '{}'::text[], false, true, now()
FROM legacy_brands
WHERE canonical_name IS NOT NULL AND normalized_key <> ''
ON CONFLICT (project_id, normalized_key) DO NOTHING;

-- Preserve the old project topics and seed their tracked-brand assignments.
INSERT INTO public.topic_brand_assignments (
  project_id, topic, brand_id, role, aliases, websites, include_in_metrics, notes
)
SELECT p.id, t.topic, b.id, 'tracked_brand', coalesce(p.brand_terms,'{}'::text[]),
  coalesce(p.brand_domains,'{}'::text[]), true, 'Migrated tracked brand identity'
FROM public.projects p
CROSS JOIN LATERAL unnest(coalesce(p.topics,'{}'::text[])) AS t(topic)
JOIN public.brand_registry b ON b.project_id=p.id
  AND b.normalized_key=regexp_replace(lower(trim(p.brand_name)), '[^a-z0-9]+', '', 'g')
ON CONFLICT (project_id,topic,brand_id) DO UPDATE SET
  role='tracked_brand', include_in_metrics=true,
  aliases=ARRAY(SELECT DISTINCT v FROM unnest(coalesce(public.topic_brand_assignments.aliases,'{}') || EXCLUDED.aliases) v WHERE btrim(v) <> ''),
  websites=CASE WHEN cardinality(EXCLUDED.websites)>0 THEN EXCLUDED.websites ELSE public.topic_brand_assignments.websites END;

-- Seed previously-discovered competitors as an editable starting point, not as
-- verified or complete 100-brand lists. Users can export and replace these lists.
INSERT INTO public.topic_brand_assignments (
  project_id, topic, brand_id, role, aliases, websites, include_in_metrics, notes
)
SELECT DISTINCT d.project_id, d.topic, b.id, 'competitor',
  coalesce(d.aliases,'{}'::text[]),
  ARRAY(SELECT DISTINCT site FROM unnest(
    ARRAY[coalesce(d.website,''),coalesce(d.normalized_domain,'')]
  ) site WHERE btrim(site) <> ''),
  true, 'Migrated from legacy discovery registry; review and complete this topic list'
FROM public.direct_competitors d
JOIN public.brand_registry b ON b.project_id=d.project_id
  AND b.normalized_key=regexp_replace(lower(trim(d.brand_name)), '[^a-z0-9]+', '', 'g')
WHERE d.topic <> 'Overall'
  AND NOT b.is_tracked_brand
ON CONFLICT (project_id,topic,brand_id) DO NOTHING;

-- Carry forward historical daily competitor observations as a starting point.
-- Where one canonical brand had multiple domains, presence/response are not summed
-- (which would double-count the same answers); citations are summed by domain.
INSERT INTO public.topic_brand_observations (
  project_id, brand_id, topic, metric_date, tracking_location, llm_provider,
  presence_count, response_count, mention_count, citation_count, average_position
)
SELECT d.project_id, b.id, d.topic, o.metric_date, o.tracking_location, o.llm_provider,
  max(o.presence_count), max(o.response_count), max(o.presence_count), sum(o.citation_count), null
FROM public.direct_competitor_observations o
JOIN public.direct_competitors d ON d.id=o.competitor_id AND d.project_id=o.project_id
JOIN public.brand_registry b ON b.project_id=d.project_id
  AND b.normalized_key=regexp_replace(lower(trim(d.brand_name)), '[^a-z0-9]+', '', 'g')
WHERE NOT b.is_tracked_brand
GROUP BY d.project_id,b.id,d.topic,o.metric_date,o.tracking_location,o.llm_provider
ON CONFLICT (project_id,brand_id,topic,metric_date,tracking_location,llm_provider) DO NOTHING;

-- Recompute period ranks/counts from the explicit fixed registry, including
-- configured competitors with zero observed mentions in the selected period.
CREATE OR REPLACE FUNCTION public.get_competitor_counts_for_period(
  p_project_id uuid, p_start_date date, p_end_date date, p_tracking_location text DEFAULT NULL
)
RETURNS TABLE(topic text, metric_date date, competitor_count bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location,p.tracking_market,'LEGACY') AS location
    FROM public.projects p WHERE p.id=p_project_id
  ),
  latest AS (
    SELECT vd.topic,max(vd.metric_date) AS metric_date
    FROM public.visibility_daily vd CROSS JOIN chosen_location cl
    WHERE vd.project_id=p_project_id AND vd.llm_provider='Overall'
      AND vd.tracking_location=cl.location
      AND vd.metric_date BETWEEN p_start_date AND p_end_date
    GROUP BY vd.topic
  )
  SELECT l.topic,l.metric_date,count(DISTINCT a.brand_id)::bigint AS competitor_count
  FROM latest l
  CROSS JOIN chosen_location cl
  LEFT JOIN public.topic_brand_assignments a ON a.project_id=p_project_id
    AND a.include_in_metrics AND a.role='competitor'
    AND (l.topic='Overall' OR a.topic=l.topic)
  GROUP BY l.topic,l.metric_date
  ORDER BY l.topic;
$$;

CREATE OR REPLACE FUNCTION public.get_direct_competitor_metrics_for_period(
  p_project_id uuid, p_start_date date, p_end_date date, p_tracking_location text DEFAULT NULL
)
RETURNS TABLE(topic text, metric_date date, visibility_rank integer, competitor_count bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location,p.tracking_market,'LEGACY') AS location
    FROM public.projects p WHERE p.id=p_project_id
  ),
  latest AS (
    SELECT vd.topic,max(vd.metric_date) AS metric_date
    FROM public.visibility_daily vd CROSS JOIN chosen_location cl
    WHERE vd.project_id=p_project_id AND vd.llm_provider='Overall'
      AND vd.tracking_location=cl.location
      AND vd.metric_date BETWEEN p_start_date AND p_end_date
    GROUP BY vd.topic
  ),
  brand_scores AS (
    SELECT vd.topic,vd.metric_date,coalesce(vd.visibility_score,0)::numeric AS brand_score
    FROM public.visibility_daily vd
    JOIN latest l ON l.topic=vd.topic AND l.metric_date=vd.metric_date
    CROSS JOIN chosen_location cl
    WHERE vd.project_id=p_project_id AND vd.llm_provider='Overall'
      AND vd.tracking_location=cl.location
  ),
  competitors AS (
    SELECT l.topic,l.metric_date,a.brand_id
    FROM latest l
    JOIN public.topic_brand_assignments a ON a.project_id=p_project_id
      AND a.role='competitor' AND a.include_in_metrics
      AND (l.topic='Overall' OR a.topic=l.topic)
    GROUP BY l.topic,l.metric_date,a.brand_id
  ),
  scored AS (
    SELECT c.topic,c.metric_date,c.brand_id,
      coalesce(100.0*o.presence_count/nullif(o.response_count,0),0)::numeric AS competitor_score
    FROM competitors c
    CROSS JOIN chosen_location cl
    LEFT JOIN public.topic_brand_observations o
      ON o.project_id=p_project_id AND o.brand_id=c.brand_id
      AND o.topic=c.topic AND o.metric_date=c.metric_date
      AND o.tracking_location=cl.location AND o.llm_provider='chatgpt'
  )
  SELECT bs.topic,bs.metric_date,
    (1+count(s.brand_id) FILTER (WHERE s.competitor_score>bs.brand_score))::integer AS visibility_rank,
    count(DISTINCT s.brand_id)::bigint AS competitor_count
  FROM brand_scores bs
  LEFT JOIN scored s ON s.topic=bs.topic AND s.metric_date=bs.metric_date
  GROUP BY bs.topic,bs.metric_date,bs.brand_score
  ORDER BY bs.topic;
$$;

CREATE OR REPLACE FUNCTION public.get_cumulative_competitors(
  p_project_id uuid, p_start_date date, p_end_date date, p_topic text DEFAULT NULL,
  p_engines text[] DEFAULT '{}', p_tracking_location text DEFAULT NULL
)
RETURNS TABLE(brand_name text, website text, visibility_score numeric, citations bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location,p.tracking_market,'LEGACY') AS location
    FROM public.projects p WHERE p.id=p_project_id
  ),
  selected AS (
    SELECT o.brand_id,
      avg(100.0*o.presence_count/nullif(o.response_count,0))::numeric AS visibility_score,
      sum(o.citation_count)::bigint AS citations
    FROM public.topic_brand_observations o
    CROSS JOIN chosen_location cl
    WHERE o.project_id=p_project_id AND o.metric_date BETWEEN p_start_date AND p_end_date
      AND o.tracking_location=cl.location
      AND o.topic=coalesce(p_topic,'Overall')
      AND (coalesce(array_length(p_engines,1),0)=0 OR o.llm_provider=ANY(p_engines))
    GROUP BY o.brand_id
  )
  SELECT b.canonical_name,
    CASE WHEN coalesce(b.primary_website,'')='' THEN NULL
      ELSE 'https://'||regexp_replace(regexp_replace(b.primary_website,'^https?://','','i'),'^www[.]','','i') END AS website,
    s.visibility_score,s.citations
  FROM selected s JOIN public.brand_registry b ON b.id=s.brand_id
  JOIN public.topic_brand_assignments a ON a.project_id=b.project_id AND a.brand_id=b.id
    AND a.role='competitor' AND a.include_in_metrics
    AND (coalesce(p_topic,'Overall')='Overall' OR a.topic=p_topic)
  WHERE b.project_id=p_project_id AND b.is_active
  ORDER BY s.citations DESC,s.visibility_score DESC NULLS LAST,b.canonical_name;
$$;

-- Defense in depth: the aggregate RPC is SECURITY DEFINER, so it explicitly
-- checks project membership rather than relying only on table-level RLS.
CREATE OR REPLACE FUNCTION public.get_third_party_mentions(
  p_project_id uuid, p_start_date date, p_end_date date, p_topic text DEFAULT NULL,
  p_engines text[] DEFAULT '{}', p_tracking_location text DEFAULT NULL
)
RETURNS TABLE(hostname text, website_name text, frequency bigint, response_frequency bigint, brand_coverage bigint, source_types text[], example_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location,p.tracking_market,'LEGACY') AS location
    FROM public.projects p
    WHERE p.id=p_project_id AND (auth.role()='service_role' OR public.is_project_member(p.id))
  ),
  selected AS (
    SELECT t.*
    FROM public.third_party_mentions t CROSS JOIN chosen_location cl
    WHERE t.project_id=p_project_id AND t.metric_date BETWEEN p_start_date AND p_end_date
      AND t.tracking_location=cl.location
      AND (p_topic IS NULL OR t.topic=p_topic)
      AND (coalesce(array_length(p_engines,1),0)=0 OR t.llm_provider=ANY(p_engines))
      AND t.hostname<>''
      AND NOT EXISTS (
        SELECT 1 FROM public.brand_registry b
        CROSS JOIN LATERAL unnest(coalesce(b.additional_websites,'{}') || ARRAY[coalesce(b.primary_website,'')]) raw(raw_site)
        CROSS JOIN LATERAL (
          SELECT CASE WHEN left(lower(split_part(split_part(regexp_replace(raw_site,'^https?://','','i'), '/', 1), ':', 1)),4)='www.'
            THEN substring(lower(split_part(split_part(regexp_replace(raw_site,'^https?://','','i'), '/', 1), ':', 1)) from 5)
            ELSE lower(split_part(split_part(regexp_replace(raw_site,'^https?://','','i'), '/', 1), ':', 1)) END AS host
        ) n
        WHERE b.project_id=t.project_id AND b.is_active AND n.host<>''
          AND (t.hostname=n.host OR t.hostname LIKE '%.'||n.host)
      )
  )
  SELECT s.hostname,coalesce(max(s.website_name),s.hostname) AS website_name,
    sum(s.frequency)::bigint AS frequency,count(DISTINCT s.response_id)::bigint AS response_frequency,
    count(DISTINCT bid)::bigint AS brand_coverage,array_agg(DISTINCT s.source_type) AS source_types,
    (array_agg(s.url ORDER BY s.metric_date DESC))[1] AS example_url
  FROM selected s LEFT JOIN LATERAL unnest(s.associated_brand_ids) bid ON true
  GROUP BY s.hostname
  ORDER BY count(DISTINCT s.response_id) DESC,sum(s.frequency) DESC,s.hostname;
$$;

REVOKE ALL ON FUNCTION public.get_third_party_mentions(uuid,date,date,text,text[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_third_party_mentions(uuid,date,date,text,text[],text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_competitor_counts_for_period(uuid,date,date,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_direct_competitor_metrics_for_period(uuid,date,date,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cumulative_competitors(uuid,date,date,text,text[],text) TO authenticated, service_role;
