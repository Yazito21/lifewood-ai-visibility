-- Issues 07/12: database-side metric integrity contract.
-- Run against a migrated database (psql -f, or the Supabase SQL editor).
-- Fails if a required constraint/trigger is missing or any published scope has a
-- metric that cannot be reproduced from raw evidence.
do $$
declare
  errors integer;
  detail text;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                 and indexname = 'tracking_runs_one_active_published_per_scope_day') then
    raise exception 'metric integrity contract: missing unique published-run index';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'visibility_daily_rank_valid_check') then
    raise exception 'metric integrity contract: missing rank validity constraint';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tracking_runs_publication_guard_upd') then
    raise exception 'metric integrity contract: missing publication guard trigger';
  end if;

  -- Competitor-change recompute pipeline (queue, triggers, worker) must be installed.
  if not exists (select 1 from pg_trigger where tgname = 'competitor_assignment_changed_row')
     or not exists (select 1 from pg_trigger where tgname = 'competitor_registry_changed_row') then
    raise exception 'metric integrity contract: missing competitor-change triggers';
  end if;
  if to_regclass('public.competitor_recompute_jobs') is null
     or to_regprocedure('public.recompute_competitor_metrics(uuid,date,date)') is null then
    raise exception 'metric integrity contract: missing recompute engine or job queue';
  end if;
  if exists (select 1 from public.check_metric_integrity(null, null, null) c where c.check_name = 'competitor_stats_out_of_date')
     and not exists (select 1 from public.competitor_recompute_jobs j where j.status in ('queued', 'running')) then
    raise exception 'metric integrity contract: competitor statistics are out of date and no recompute is queued';
  end if;

  -- The tracking edge function runs as service_role and must be able to write every table it persists to.
  -- (A missing grant on citation_occurrences made every tracking run fail at the cleanup step.)
  select string_agg(t, ', ') into detail
  from unnest(array['ai_responses', 'citation_occurrences', 'citations', 'competitors', 'direct_competitor_observations',
                    'response_brand_evidence', 'third_party_mentions', 'topic_brand_observations', 'visibility_daily',
                    'tracking_runs', 'tracking_run_stages', 'tracking_batches', 'tracking_batch_topics']) t
  where not (has_table_privilege('service_role', 'public.' || t, 'SELECT')
         and has_table_privilege('service_role', 'public.' || t, 'INSERT')
         and has_table_privilege('service_role', 'public.' || t, 'UPDATE')
         and has_table_privilege('service_role', 'public.' || t, 'DELETE'));
  if detail is not null then
    raise exception 'metric integrity contract: service_role lacks DML privileges on: %', detail;
  end if;

  -- Rows from 2026-10-22 onward carry canonical v2 lineage; earlier rows are legacy and reported as warnings.
  select count(*), string_agg(distinct c.check_name, ', ') into errors, detail
  from public.check_metric_integrity(null, date '2026-10-22', null) c
  where c.severity = 'error';
  if errors > 0 then
    raise exception 'metric integrity contract: % error(s): %', errors, detail;
  end if;

  -- Rank 1 is best and a verified rank never exceeds its population.
  if exists (
    select 1 from public.visibility_daily
    where rank_population_status = 'verified'
      and (visibility_rank < 1 or visibility_rank > rank_population_count)
  ) then
    raise exception 'metric integrity contract: verified rank outside 1..population';
  end if;
end $$;
