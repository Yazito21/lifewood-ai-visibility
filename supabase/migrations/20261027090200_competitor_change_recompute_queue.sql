-- Automatic recompute of historical competitor statistics whenever a competitor list changes.
--
--   assignments / registry change  ->  queued job (one per project, debounced)  ->  worker (pg_cron, every minute)
--   worker runs recompute_competitor_metrics(project) over the full history using the raw stored responses.
-- Replaced assignments are archived automatically so earlier lists remain auditable.

create table if not exists public.competitor_recompute_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  reason text not null default 'competitor_set_changed',
  requested_at timestamptz not null default now(),
  requested_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  summary jsonb,
  error_message text
);
create unique index if not exists competitor_recompute_jobs_one_queued
  on public.competitor_recompute_jobs (project_id) where status = 'queued';
create index if not exists competitor_recompute_jobs_project_idx
  on public.competitor_recompute_jobs (project_id, requested_at desc);
alter table public.competitor_recompute_jobs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'competitor_recompute_jobs' and policyname = 'members read recompute jobs') then
    create policy "members read recompute jobs" on public.competitor_recompute_jobs
      for select to authenticated using (public.is_project_member(project_id));
  end if;
end $$;
grant select on public.competitor_recompute_jobs to authenticated;
grant all on public.competitor_recompute_jobs to service_role;

create or replace function public.enqueue_competitor_recompute(p_project_id uuid, p_reason text default 'competitor_set_changed')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.competitor_recompute_jobs (project_id, reason, requested_by)
  values (p_project_id, p_reason, auth.uid())
  on conflict (project_id) where status = 'queued' do update set requested_at = now(), reason = excluded.reason
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.enqueue_competitor_recompute(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_competitor_recompute(uuid, text) to service_role;

-- Competitor assignment changes: archive what was replaced and queue a recompute.
create or replace function public.competitor_assignment_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare changed boolean := false;
begin
  if tg_op = 'DELETE' then
    if old.role = 'competitor' then
      insert into public.topic_brand_assignments_archive select old.*, now(), 'deleted';
      perform public.enqueue_competitor_recompute(old.project_id);
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    changed := (old.role, old.include_in_metrics, old.topic, old.brand_id, old.aliases, old.websites)
               is distinct from (new.role, new.include_in_metrics, new.topic, new.brand_id, new.aliases, new.websites);
    if changed and (old.role = 'competitor' or new.role = 'competitor') then
      insert into public.topic_brand_assignments_archive select old.*, now(), 'updated';
      perform public.enqueue_competitor_recompute(new.project_id);
    end if;
    return new;
  else
    if new.role = 'competitor' then perform public.enqueue_competitor_recompute(new.project_id); end if;
    return new;
  end if;
end;
$$;
drop trigger if exists competitor_assignment_changed_row on public.topic_brand_assignments;
create trigger competitor_assignment_changed_row
  after insert or update or delete on public.topic_brand_assignments
  for each row execute function public.competitor_assignment_changed();

-- Aliases / websites / active flag of an assigned competitor changed in the central registry.
create or replace function public.competitor_registry_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (old.canonical_name, old.aliases, old.primary_website, old.additional_websites, old.is_active)
     is distinct from (new.canonical_name, new.aliases, new.primary_website, new.additional_websites, new.is_active)
     and exists (select 1 from public.topic_brand_assignments a
                 where a.brand_id = new.id and a.role = 'competitor' and a.include_in_metrics) then
    perform public.enqueue_competitor_recompute(new.project_id);
  end if;
  return new;
end;
$$;
drop trigger if exists competitor_registry_changed_row on public.brand_registry;
create trigger competitor_registry_changed_row
  after update on public.brand_registry
  for each row execute function public.competitor_registry_changed();

-- Worker: one job per call (the engine uses transaction-scoped temp tables). Waits 20s after the last change so
-- multi-statement saves (delete + insert) settle into one recompute.
create or replace function public.process_competitor_recompute_jobs()
returns integer language plpgsql security definer set search_path = public set statement_timeout = '30min' as $$
declare j record; res jsonb;
begin
  update public.competitor_recompute_jobs set status = 'failed', completed_at = now(),
    error_message = 'timed out while running'
  where status = 'running' and started_at < now() - interval '1 hour';

  select * into j from public.competitor_recompute_jobs
  where status = 'queued' and requested_at <= now() - interval '20 seconds'
  order by requested_at limit 1 for update skip locked;
  if not found then return 0; end if;

  update public.competitor_recompute_jobs set status = 'running', started_at = now() where id = j.id;
  begin
    res := public.recompute_competitor_metrics(j.project_id);
    update public.competitor_recompute_jobs set status = 'completed', completed_at = now(), summary = res where id = j.id;
  exception when others then
    update public.competitor_recompute_jobs set status = 'failed', completed_at = now(), error_message = left(sqlerrm, 500) where id = j.id;
  end;
  return 1;
end;
$$;
revoke all on function public.process_competitor_recompute_jobs() from public, anon, authenticated;
grant execute on function public.process_competitor_recompute_jobs() to service_role;

-- Manual trigger for project admins ("Recalculate now" in Settings).
create or replace function public.request_competitor_recompute(p_project_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
    or exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = auth.uid() and m.role in ('admin', 'superadmin'))
  ) then
    raise exception 'Only project admins can request a recompute.';
  end if;
  return public.enqueue_competitor_recompute(p_project_id, 'manual_request');
end;
$$;
revoke all on function public.request_competitor_recompute(uuid) from public, anon;
grant execute on function public.request_competitor_recompute(uuid) to authenticated, service_role;

create extension if not exists pg_cron;
select cron.schedule('process-competitor-recompute-jobs', '* * * * *', 'select public.process_competitor_recompute_jobs()');

-- Integrity report (Issues 05/07/12). One row per violated check; severity 'error' means a metric must not be trusted.
create or replace function public.check_metric_integrity(
  p_project_id uuid default null, p_start_date date default null, p_end_date date default null
) returns table(check_name text, severity text, project_id uuid, metric_date date, topic text, detail text)
language sql stable security definer set search_path = public as $$
  with vd as (
    select v.*, tr.provider as run_provider, tr.status as run_status, tr.published_at as run_published_at, tr.run_kind
    from public.visibility_daily v
    left join public.tracking_runs tr on tr.id = v.run_id
    where v.llm_provider = 'Overall'
      and (p_project_id is null or v.project_id = p_project_id)
      and (p_start_date is null or v.metric_date >= p_start_date)
      and (p_end_date is null or v.metric_date <= p_end_date)
  )
  select 'tracked_score_matches_evidence'::text, 'error'::text, v.project_id, v.metric_date, v.topic,
    format('stored %s vs %s/%s = %s', v.visibility_score, t.presence_count, t.response_count,
           round(t.presence_count::numeric / nullif(t.response_count, 0) * 100, 1))
  from vd v cross join lateral public.run_tracked_presence(v.run_id, v.topic) t
  where v.run_id is not null and v.run_kind in ('topic', 'full') and t.response_count > 0
    and abs(round(t.presence_count::numeric / t.response_count * 100, 1) - v.visibility_score) > 0.05
  union all
  select 'rank_matches_canonical', 'error', v.project_id, v.metric_date, v.topic,
    format('stored %s/%s vs canonical %s/%s', v.visibility_rank, v.rank_population_count, k.visibility_rank, k.rank_population_count)
  from vd v
  cross join lateral public.canonical_scoped_rank(v.project_id, v.run_id, v.topic, v.metric_date,
       coalesce(v.run_provider, 'chatgpt'), v.tracking_location, v.presence_count, v.response_count) k
  where v.run_id is not null and v.presence_count is not null
    and (v.visibility_rank is distinct from k.visibility_rank or v.rank_population_count is distinct from k.rank_population_count)
  union all
  select 'rank_population_unverified', 'warning', v.project_id, v.metric_date, v.topic,
    'rank population is unverified (legacy lineage); excluded from verified comparisons'
  from vd v where v.rank_population_status = 'unverified' and v.visibility_rank is not null
  union all
  select 'competitor_coverage_incomplete', 'warning', v.project_id, v.metric_date, v.topic,
    format('%s of %s registered competitors have valid observations', c.observed, c.expected)
  from vd v
  cross join lateral (
    select max(o.expected_competitor_count) expected, max(o.observed_competitor_count) observed
    from public.get_published_competitor_observations(v.project_id, v.metric_date, v.topic,
         coalesce(v.run_provider, 'chatgpt'), v.tracking_location) o
  ) c
  where v.run_id is not null and v.run_published_at is not null and c.observed < c.expected
  union all
  select 'citation_count_matches_occurrences', 'error', v.project_id, v.metric_date, v.topic,
    format('daily %s vs published-run occurrences %s', v.citation_count, occ.n)
  from vd v
  cross join lateral (
    select count(*)::integer n from public.citation_occurrences co
    join public.brand_registry b on b.id = co.entity_id and b.is_tracked_brand
    where co.project_id = v.project_id and co.metric_date = v.metric_date
      and co.tracking_location = v.tracking_location and (v.topic = 'Overall' or co.topic = v.topic)
      and co.run_id in (select coalesce(t.source_run_id, t.id) from public.tracking_runs t
                        where t.id = any(coalesce(v.source_run_ids, array[v.run_id])))
  ) occ
  where v.run_id is not null and v.metric_version is not null and v.run_kind in ('topic', 'overall_aggregate')
    and v.citation_count <> occ.n
  union all
  select 'citation_occurrences_from_unpublished_runs', 'warning', co.project_id, co.metric_date, co.topic,
    format('%s occurrence rows belong to runs that are not the published run (retained for audit, excluded by latest-response selection)', count(*))
  from public.citation_occurrences co
  join public.tracking_runs tr on tr.id = co.run_id
  where (tr.published_at is null or tr.superseded_at is not null)
    and (p_project_id is null or co.project_id = p_project_id)
    and (p_start_date is null or co.metric_date >= p_start_date) and (p_end_date is null or co.metric_date <= p_end_date)
  group by co.project_id, co.metric_date, co.topic
  union all
  select 'daily_metric_without_published_run', 'error', v.project_id, v.metric_date, v.topic,
    'visibility_daily row references a run that is not published'
  from vd v where v.run_id is not null and (v.run_published_at is null or v.run_status <> 'completed')
  union all
  select 'competitor_observations_without_run', 'warning', o.project_id, o.metric_date, o.topic,
    format('%s observation rows have no run lineage', count(*))
  from public.topic_brand_observations o
  where o.run_id is null and (p_project_id is null or o.project_id = p_project_id)
    and (p_start_date is null or o.metric_date >= p_start_date) and (p_end_date is null or o.metric_date <= p_end_date)
  group by o.project_id, o.metric_date, o.topic
  union all
  select 'competitor_stats_out_of_date', 'warning', o.project_id, o.metric_date, o.topic,
    format('%s observation rows belong to brands that are no longer assigned as competitors; a recompute is pending', count(*))
  from public.topic_brand_observations o
  join public.tracking_runs tr on tr.id = o.run_id and tr.published_at is not null and tr.superseded_at is null
  where o.topic <> 'Overall' and (p_project_id is null or o.project_id = p_project_id)
    and (p_start_date is null or o.metric_date >= p_start_date) and (p_end_date is null or o.metric_date <= p_end_date)
    and not exists (select 1 from public.topic_brand_assignments a
                    where a.project_id = o.project_id and a.brand_id = o.brand_id and a.topic = o.topic
                      and a.role = 'competitor' and a.include_in_metrics)
  group by o.project_id, o.metric_date, o.topic
  union all
  select 'duplicate_evidence', 'error', d.project_id, null::date, d.topic, format('%s duplicated evidence keys', count(*))
  from (select e.project_id, e.topic, e.response_id, e.brand_id, e.match_source, e.matched_value
        from public.response_brand_evidence e group by 1,2,3,4,5,6 having count(*) > 1) d
  group by d.project_id, d.topic;
$$;

revoke all on function public.check_metric_integrity(uuid, date, date) from public, anon, authenticated;
grant execute on function public.check_metric_integrity(uuid, date, date) to service_role;

comment on function public.check_metric_integrity(uuid, date, date) is
  'Scoped reconciliation of raw responses, evidence, citations, daily metrics and competitor observations. Rows with severity=error indicate a metric that must not be trusted.';
