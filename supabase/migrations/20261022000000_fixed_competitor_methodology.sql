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
