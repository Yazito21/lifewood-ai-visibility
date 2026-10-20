-- Support dashboard and analytics citation filters without scanning all project citations.
CREATE INDEX IF NOT EXISTS citations_project_location_date_topic_idx
  ON public.citations (project_id, tracking_location, metric_date, topic)
  INCLUDE (llm_provider, is_brand_related);

CREATE INDEX IF NOT EXISTS visibility_daily_project_location_provider_date_topic_idx
  ON public.visibility_daily (project_id, tracking_location, llm_provider, metric_date, topic);
