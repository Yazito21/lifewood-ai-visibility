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
