-- Reconcile tracking runs that were terminated before the Edge Function could finalize them.
-- Completed AI responses are retained; this marks the run as partial rather than inviting
-- a blind full rerun that would spend tokens again.

create or replace function public.reconcile_stale_tracking_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  with response_counts as (
    select
      ar.run_id,
      count(*) filter (where ar.response_status = 'completed')::integer as completed_count
    from public.ai_responses ar
    group by ar.run_id
  )
  update public.tracking_runs tr
  set
    status = case when coalesce(rc.completed_count, 0) > 0 then 'partial' else 'failed' end,
    completed_prompts = coalesce(rc.completed_count, 0),
    failed_prompts = greatest(tr.total_prompts - coalesce(rc.completed_count, 0), 0),
    error_message = case
      when coalesce(rc.completed_count, 0) > 0
        then 'Run was interrupted before finalization. Saved responses were preserved; recover metrics before rerunning prompts.'
      else 'Run was interrupted before responses were saved. Check Edge Function logs before retrying.'
    end,
    completed_at = now()
  from response_counts rc
  where tr.id = rc.run_id
    and tr.status = 'running'
    and tr.started_at < now() - interval '10 minutes';

  get diagnostics updated_count = row_count;

  -- Runs with no persisted responses also need to be closed.
  update public.tracking_runs tr
  set
    status = 'failed',
    completed_prompts = 0,
    failed_prompts = tr.total_prompts,
    error_message = 'Run was interrupted before responses were saved. Check Edge Function logs before retrying.',
    completed_at = now()
  where tr.status = 'running'
    and tr.started_at < now() - interval '10 minutes'
    and not exists (
      select 1 from public.ai_responses ar where ar.run_id = tr.id
    );

  get diagnostics updated_count = updated_count + row_count;
  return updated_count;
end;
$$;

revoke all on function public.reconcile_stale_tracking_runs() from public, anon, authenticated;
grant execute on function public.reconcile_stale_tracking_runs() to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-stale-tracking-runs') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'reconcile-stale-tracking-runs';
  end if;

  perform cron.schedule(
    'reconcile-stale-tracking-runs',
    '*/5 * * * *',
    'select public.reconcile_stale_tracking_runs();'
  );
end;
$$;
