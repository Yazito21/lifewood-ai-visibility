-- DATA-03/04: schema contract checks for the natural grain used by aggregation upserts.
-- Run against a migrated Supabase database in integration validation.
do $$
declare
  required_indexes text[] := array[
    'response_brand_evidence_response_id_brand_id_topic_match_so_key',
    'third_party_mentions_project_id_response_id_canonical_url_s_key',
    'topic_brand_observations_pkey',
    'visibility_daily_project_date_topic_engine_location_key',
    'citations_daily_url_location_unique_idx',
    'competitors_daily_brand_location_unique_idx'
  ];
  missing text[];
begin
  select array_agg(required_name)
  into missing
  from unnest(required_indexes) as required_name
  where not exists (
    select 1 from pg_indexes i
    where i.schemaname = 'public' and i.indexname = required_name
  );
  if missing is not null then
    raise exception 'DATA-03/04 schema contract failure; missing unique indexes: %', missing;
  end if;
end $$;
