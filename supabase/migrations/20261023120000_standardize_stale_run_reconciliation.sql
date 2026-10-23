create or replace function public.reconcile_stale_tracking_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
  current_count integer := 0;
begin
  with response_counts as (
    select ar.run_id,
      count(*) filter (where ar.response_status = 'completed')::integer as provider_success,
      count(*) filter (where ar.response_status <> 'completed')::integer as provider_failure,
      count(*) filter (where ar.response_status = 'completed' and ar.response_analysis->>'status' = 'completed')::integer as analyzed,
      count(*)::integer as attempted
    from public.ai_responses ar
    group by ar.run_id
  )
  update public.tracking_runs tr
  set status = case when coalesce(rc.analyzed,0) > 0 then 'partial' else 'failed' end,
      attempted_prompts = coalesce(rc.attempted,0),
      provider_successful_prompts = coalesce(rc.provider_success,0),
      provider_failed_prompts = coalesce(rc.provider_failure,0),
      analysis_successful_prompts = coalesce(rc.analyzed,0),
      published_prompts = 0,
      completed_prompts = 0,
      failed_prompts = greatest(tr.total_prompts - coalesce(rc.analyzed,0),0),
      stage_code = 'INTERRUPTED',
      error_code = 'RUN_INTERRUPTED',
      error_details = case when coalesce(rc.analyzed,0)>0
        then 'Run stopped before finalization. Provider responses and analysis records are retained; derived metrics may require reconciliation.'
        else 'Run stopped before finalization. Inspect stage journal and provider logs before retrying.' end,
      error_message = case when coalesce(rc.analyzed,0)>0
        then 'Run interrupted; saved responses retained, publication not confirmed.'
        else 'Run interrupted before publication.' end,
      completed_at = now()
  from response_counts rc
  where tr.id=rc.run_id and tr.status='running' and tr.started_at < now()-interval '10 minutes';
  get diagnostics current_count = row_count;
  updated_count := updated_count + current_count;

  update public.tracking_runs tr
  set status='failed', attempted_prompts=0, provider_successful_prompts=0, provider_failed_prompts=0,
      analysis_successful_prompts=0, published_prompts=0, completed_prompts=0,
      failed_prompts=greatest(tr.total_prompts,0), stage_code='INTERRUPTED',
      error_code='RUN_INTERRUPTED_NO_RESPONSES',
      error_details='Run stopped before any response rows were persisted. Actual provider attempt counts are unavailable.',
      error_message='Run interrupted before response persistence; attempted count is unknown.',
      completed_at=now()
  where tr.status='running' and tr.started_at < now()-interval '10 minutes'
    and not exists(select 1 from public.ai_responses ar where ar.run_id=tr.id);
  get diagnostics current_count = row_count;
  updated_count := updated_count + current_count;
  return updated_count;
end;
$$;
revoke all on function public.reconcile_stale_tracking_runs() from public, anon, authenticated;
grant execute on function public.reconcile_stale_tracking_runs() to service_role;