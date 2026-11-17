-- Standardise category-scoped run terminology in persisted tracking_runs data.
-- Legacy production rows currently use run_kind='topic'. Convert them in place
-- while retaining the existing full and overall_aggregate run kinds.
begin;

alter table public.tracking_runs
  drop constraint if exists tracking_runs_run_kind_check;

alter table public.tracking_runs
  drop constraint if exists tracking_runs_run_kind_check;

-- Several pre-existing SQL functions are installed before the replacement
-- migrations. Update only run_kind predicates/assignments, not historical JSON
-- metadata keys such as tracking_run_stages.metadata->>'topic'.
do $migration$
declare
  v record;
  v_definition text;
  v_updated text;
begin
  for v in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%run_kind%'
      and pg_get_functiondef(p.oid) like '%''topic''%'
  loop
    v_definition := pg_get_functiondef(v.oid);
    v_updated := v_definition;
    v_updated := replace(v_updated, 'run_kind = ''topic''', 'run_kind = ''category''');
    v_updated := replace(v_updated, 'run_kind is distinct from ''topic''', 'run_kind is distinct from ''category''');
    v_updated := replace(v_updated, 'run_kind <> ''topic''', 'run_kind <> ''category''');
    v_updated := replace(v_updated, 'run_kind in (''topic'',', 'run_kind in (''category'',');
    v_updated := replace(v_updated, 'run_kind = ''topic''::text', 'run_kind = ''category''::text');
    v_updated := replace(v_updated, 'then ''topic'' end', 'then ''category'' end');
    v_updated := replace(v_updated, 'run_kind := ''topic''', 'run_kind := ''category''');
    v_updated := replace(v_updated, 'fr.completed_at, ''topic'', fr.id', 'fr.completed_at, ''category'', fr.id');
    if v_updated is distinct from v_definition then
      execute v_updated;
    end if;
  end loop;
end
$migration$;

update public.tracking_runs
set run_kind = 'category'
where run_kind = 'topic';

alter table public.tracking_runs
  add constraint tracking_runs_run_kind_check
  check (run_kind is null or run_kind = any (array['category'::text, 'full'::text, 'overall_aggregate'::text]));

comment on column public.tracking_runs.run_kind is
  'category = one configured category run; full = legacy all-category run; overall_aggregate = derived Overall aggregate.';

-- Several pre-existing SQL functions are installed before the replacement
-- migrations. Update only run_kind predicates/assignments, not historical JSON
-- metadata keys such as tracking_run_stages.metadata->>'topic'.
do $migration$
declare
  v record;
  v_definition text;
  v_updated text;
begin
  for v in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%run_kind%'
      and pg_get_functiondef(p.oid) like '%''topic''%'
  loop
    v_definition := pg_get_functiondef(v.signature);
    v_updated := v_definition;
    v_updated := replace(v_updated, 'run_kind = ''topic''', 'run_kind = ''category''');
    v_updated := replace(v_updated, 'run_kind is distinct from ''topic''', 'run_kind is distinct from ''category''');
    v_updated := replace(v_updated, 'run_kind <> ''topic''', 'run_kind <> ''category''');
    v_updated := replace(v_updated, 'run_kind in (''topic'',', 'run_kind in (''category'',');
    v_updated := replace(v_updated, 'run_kind = ''topic''::text', 'run_kind = ''category''::text');
    v_updated := replace(v_updated, 'then ''topic'' end', 'then ''category'' end');
    v_updated := replace(v_updated, 'run_kind := ''topic''', 'run_kind := ''category''');
    v_updated := replace(v_updated, 'fr.completed_at, ''topic'', fr.id', 'fr.completed_at, ''category'', fr.id');
    if v_updated is distinct from v_definition then
      execute v_updated;
    end if;
  end loop;
end
$migration$;


alter table public.tracking_runs
  add constraint tracking_runs_run_kind_check
  check (run_kind is null or run_kind = any (array['category'::text, 'full'::text, 'overall_aggregate'::text]));

comment on column public.tracking_runs.run_kind is
  'category = one configured category run; full = legacy all-category run; overall_aggregate = derived Overall aggregate.';


commit;
