-- Replacement-rerun migration smoke contract.
-- Runs only against the disposable local Supabase database in GitHub Actions.
-- This is a schema/security smoke test, not a substitute for behavioural fixtures.

do $$
declare
  fn text;
  rel text;
begin
  foreach fn in array array[
    'public.stage_tracking_candidate_rows(uuid,text,jsonb)',
    'public.validate_tracking_run_candidate(uuid)',
    'public.preview_tracking_run_replacement(uuid)',
    'public.promote_tracking_run_candidate(uuid,uuid)'
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
    'public.promote_tracking_run_candidate(uuid,uuid)'
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

  -- All RPCs that read or mutate candidate state must run with a fixed safe search_path.
  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      'public.stage_tracking_candidate_rows(uuid,text,jsonb)'::regprocedure,
      'public.validate_tracking_run_candidate(uuid)'::regprocedure,
      'public.preview_tracking_run_replacement(uuid)'::regprocedure,
      'public.promote_tracking_run_candidate(uuid,uuid)'::regprocedure
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
