-- Contract checks for the competitor recompute/replacement boundary.
-- Behavioural fixtures for legacy imported and source-run datasets are tracked separately.
do $competitor_recompute_contract$
declare
  v_promote text := pg_get_functiondef('public.promote_tracking_run_candidate(uuid,uuid)'::regprocedure);
  v_recompute text := pg_get_functiondef('public.recompute_competitor_metrics(uuid,date,date)'::regprocedure);
  v_leaderboard text := pg_get_functiondef('public.get_published_run_ids_for_leaderboard(uuid,date,date,text,text,text)'::regprocedure);
  v_lock text := '__TRACKING_REPLACEMENT_RECOMPUTE__';
begin
  if position(v_lock in v_promote) = 0 or position(v_lock in v_recompute) = 0 then
    raise exception 'replacement promotion and competitor recomputation must acquire the same project advisory lock';
  end if;

  if position('coalesce(tr.source_run_id, tr.id)' in v_recompute) = 0
     or position('profound_import' in v_recompute) = 0 then
    raise exception 'competitor recomputation no longer supports legacy source-run/imported response lineage';
  end if;

  if position('category_brand_observations_archive' in v_recompute) = 0
     or position('competitor set replaced' in v_recompute) = 0 then
    raise exception 'removed competitor observations must be archived before active rows are removed';
  end if;

  if position('delete from public.ai_responses' in lower(v_recompute)) > 0
     or position('delete from public.direct_competitors' in lower(v_recompute)) > 0
     or position('delete from public.direct_competitor_observations' in lower(v_recompute)) > 0 then
    raise exception 'competitor recomputation must not delete source responses or direct-competitor configuration/observations';
  end if;

  if position('superseded_at' in lower(v_leaderboard)) = 0 then
    raise exception 'leaderboard run lookup must exclude superseded runs';
  end if;

  if position('tr.project_id = p_project_id' in v_recompute) = 0
     or position('tr.superseded_at is null' in v_recompute) = 0 then
    raise exception 'competitor recomputation must remain project-scoped and use active published runs';
  end if;
end
$competitor_recompute_contract$;

select 'replacement rerun competitor recompute contract passed' as result;
