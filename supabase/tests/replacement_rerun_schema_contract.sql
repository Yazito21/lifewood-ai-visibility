-- Replacement-rerun migration smoke contract.
-- Runs only against the disposable local Supabase database in GitHub Actions.
-- This is a schema/security smoke test, not a substitute for behavioural fixtures.

do $$
declare
  fn text;
  rel text;
  publication_guard_definition text;
begin
  foreach fn in array array[
    'public.stage_tracking_candidate_rows(uuid,text,jsonb)',
    'public.validate_tracking_run_candidate(uuid)',
    'public.preview_tracking_run_replacement(uuid)',
    'public.promote_tracking_run_candidate(uuid,uuid)',
    'public.publish_engine_overall_metrics(uuid,date,text,text,boolean)'
  ] loop
    if to_regprocedure(fn) is null then
      raise exception 'replacement rerun contract: missing function %', fn;
    end if;
  end loop;

  foreach rel in array array[
    'public.tracking_run_candidate_rows',
    'public.tracking_run_replacements'
  ] loop
    if to_regclass(rel) is null then
      raise exception 'replacement rerun contract: missing relation %', rel;
    end if;
  end loop;

  if not coalesce((select relrowsecurity from pg_class where oid = 'public.tracking_run_candidate_rows'::regclass), false) then
    raise exception 'replacement rerun contract: candidate staging RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.tracking_run_candidate_rows', 'SELECT')
     or has_table_privilege('authenticated', 'public.tracking_run_candidate_rows', 'SELECT') then
    raise exception 'replacement rerun contract: client role can read candidate staging rows';
  end if;

  if has_function_privilege('anon', 'public.promote_tracking_run_candidate(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.promote_tracking_run_candidate(uuid,uuid)', 'EXECUTE')
     or exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid = 'public.promote_tracking_run_candidate(uuid,uuid)'::regprocedure
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'replacement rerun contract: untrusted role can execute promotion RPC';
  end if;

  if not has_function_privilege('service_role', 'public.promote_tracking_run_candidate(uuid,uuid)', 'EXECUTE') then
    raise exception 'replacement rerun contract: service_role cannot execute promotion RPC';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'promote_tracking_run_candidate'
      and p.prosecdef
  ) then
    raise exception 'replacement rerun contract: promotion RPC must be SECURITY DEFINER';
  end if;

  -- Every candidate-management RPC must be unavailable to browser-facing roles.
  foreach fn in array array[
    'public.stage_tracking_candidate_rows(uuid,text,jsonb)',
    'public.validate_tracking_run_candidate(uuid)',
    'public.preview_tracking_run_replacement(uuid)',
    'public.promote_tracking_run_candidate(uuid,uuid)',
    'public.publish_engine_overall_metrics(uuid,date,text,text,boolean)'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE')
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         where p.oid = fn::regprocedure
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
       ) then
      raise exception 'replacement rerun contract: untrusted role can execute %', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'replacement rerun contract: service_role cannot execute %', fn;
    end if;
  end loop;

  -- Promotion must acquire its exact-scope transaction lock before rebuilding
  -- the predecessor preview. Otherwise concurrent candidates can act on stale
  -- predecessor IDs after waiting for the same lock.
  declare
    promotion_definition text;
  begin
    select pg_get_functiondef('public.promote_tracking_run_candidate(uuid,uuid)'::regprocedure)
      into promotion_definition;
    if position('v_run.project_id::text || ''|__TRACKING_REPLACEMENT_RECOMPUTE__''' in promotion_definition) = 0
       or position('v_run.project_id::text || ''|__TRACKING_REPLACEMENT_RECOMPUTE__''' in promotion_definition)
          > position('preview_tracking_run_replacement' in promotion_definition)
       or position('v_run.project_id::text || ''|'' || v_date::text || ''|__OVERALL_REFRESH__|'' || v_run.provider || ''|'' || v_location' in promotion_definition) = 0
       or position('v_run.project_id::text || ''|'' || v_date::text || ''|__OVERALL_REFRESH__|'' || v_run.provider || ''|'' || v_location' in promotion_definition)
          > position('preview_tracking_run_replacement' in promotion_definition) then
      raise exception 'replacement rerun contract: executable project and shared Overall locks must precede predecessor preview';
    end if;

    if position('p_project_id::text || ''|__TRACKING_REPLACEMENT_RECOMPUTE__''' in
         pg_get_functiondef('public.publish_engine_overall_metrics(uuid,date,text,text,boolean)'::regprocedure)) = 0
       or position('p_project_id::text || ''|__TRACKING_REPLACEMENT_RECOMPUTE__''' in
         pg_get_functiondef('public.recompute_competitor_metrics(uuid,date,date)'::regprocedure)) = 0 then
      raise exception 'replacement rerun contract: competitor recompute and Overall publication must execute the shared project lock';
    end if;

    -- Later migrations must not reintroduce the legacy location-agnostic
    -- two-argument presence helper when redefining Overall/recompute functions.
    if position('run_tracked_presence(m.run_id, m.category, p_location)' in
         pg_get_functiondef('public.publish_engine_overall_metrics(uuid,date,text,text,boolean)'::regprocedure)) = 0
       or position('run_tracked_presence(fr.id, tn, fr.tracking_location)' in
         pg_get_functiondef('public.recompute_competitor_metrics(uuid,date,date)'::regprocedure)) = 0
       or position('run_tracked_presence(m.run_id, m.category)' in
         pg_get_functiondef('public.publish_engine_overall_metrics(uuid,date,text,text,boolean)'::regprocedure)) > 0 then
      raise exception 'replacement rerun contract: Overall/recompute must use location-scoped presence counts';
    end if;
  end;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tracking_runs'::regclass
      and conname = 'tracking_runs_run_kind_check'
      and pg_get_constraintdef(oid) like '%category%'
      and pg_get_constraintdef(oid) not like '%topic%'
  ) then
    raise exception 'replacement rerun contract: tracking_runs must use category run_kind terminology';
  end if;

  if exists (select 1 from public.tracking_runs where run_kind = 'topic') then
    raise exception 'replacement rerun contract: legacy topic run_kind values remain';
  end if;

  if not exists (
    select 1
    from public.tracking_runs tr
    join public.projects p on p.id = tr.project_id
    where p.brand_name = 'Replacement Rerun Legacy Run Kind Migration Fixture'
      and tr.category = 'Skin'
      and tr.run_kind = 'category'
      and tr.status = 'failed'
  ) then
    raise exception 'replacement rerun contract: legacy run kind was not converted to category';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%run_kind%'
      and (
        pg_get_functiondef(p.oid) like '%run_kind = ''topic''%'
        or pg_get_functiondef(p.oid) like '%run_kind is distinct from ''topic''%'
        or pg_get_functiondef(p.oid) like '%run_kind in (''topic'',%'
        or pg_get_functiondef(p.oid) like '%v_loc, g.category, ''topic'', ''profound_import''%'
      )
  ) then
    raise exception 'replacement rerun contract: a public SQL function still uses the legacy topic run kind';
  end if;

  select pg_get_functiondef('public.tracking_runs_publication_guard()'::regprocedure)
    into publication_guard_definition;
  if position('else ''category'' end' in publication_guard_definition) = 0
     or position('run_kind is distinct from ''topic''' in publication_guard_definition) > 0 then
    raise exception 'replacement rerun contract: publication trigger still uses legacy run kind';
  end if;

  -- All RPCs that read or mutate candidate state must run with a fixed safe search_path.
  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      'public.stage_tracking_candidate_rows(uuid,text,jsonb)'::regprocedure,
      'public.validate_tracking_run_candidate(uuid)'::regprocedure,
      'public.preview_tracking_run_replacement(uuid)'::regprocedure,
      'public.promote_tracking_run_candidate(uuid,uuid)'::regprocedure,
      'public.publish_engine_overall_metrics(uuid,date,text,text,boolean)'::regprocedure
    )
    and (not p.prosecdef or p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) setting
                        where setting like 'search_path=public, pg_temp%'))
  ) then
    raise exception 'replacement rerun contract: RPC missing SECURITY DEFINER or fixed search_path';
  end if;
end
$$;

select 'replacement rerun schema contract passed' as result;
