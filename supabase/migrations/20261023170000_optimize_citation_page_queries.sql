-- Improve citation page filters and the brand-domain exclusion lookup.
-- These indexes align with project/location/date/provider filters used by the page.
CREATE INDEX IF NOT EXISTS citations_project_location_period_provider_idx
  ON public.citations (project_id, tracking_location, metric_date, llm_provider, topic, is_brand_related);

CREATE INDEX IF NOT EXISTS third_party_mentions_project_location_period_provider_idx
  ON public.third_party_mentions (project_id, tracking_location, metric_date, llm_provider, topic, hostname);

CREATE INDEX IF NOT EXISTS brand_registry_project_active_lookup_idx
  ON public.brand_registry (project_id, is_active);
