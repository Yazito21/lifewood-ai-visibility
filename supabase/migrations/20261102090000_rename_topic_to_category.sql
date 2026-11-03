-- Renames "topic" to "category" across the schema: tables, columns, constraints, indexes, policies, comments and functions.
--
-- Stored data is not touched. In particular these data values keep the word "topic" because rows already carry them:
--   * tracking_runs.run_kind = 'topic' (the single-category run kind) and the check constraint that allows it,
--   * jsonb keys in historical rows (tracking_run_stages.metadata ->> 'topic', ai_responses.project_snapshot -> 'topics').
-- Profound's own vocabulary (profound_topic) is also kept. Quoted 'topic' literals in function bodies are therefore preserved.
--
-- Functions are re-created from their current definitions with the words replaced. A function whose parameter or return
-- column names change cannot be replaced in place, so it is dropped and re-created with its privileges restored.

create or replace function pg_temp.to_category(t text) returns text language sql immutable as $f$
  select replace(replace(
    replace(replace(replace(replace(replace(replace(replace(replace(
      t, '''topic''', E'\u0001'), 'profound_topic', E'\u0002'),
      'TOPICS', 'CATEGORIES'), 'Topics', 'Categories'), 'topics', 'categories'),
      'TOPIC', 'CATEGORY'), 'Topic', 'Category'), 'topic', 'category'),
    E'\u0001', '''topic'''), E'\u0002', 'profound_topic')
$f$;

-- Index/constraint names are limited to 63 characters; keep a trailing _key/_idx/_pkey suffix when shortening.
create or replace function pg_temp.to_category_name(t text) returns text language plpgsql immutable as $f$
declare n text := pg_temp.to_category(t); suffix text;
begin
  if length(n) <= 63 then return n; end if;
  suffix := coalesce((regexp_match(n, '(_pkey|_key|_idx|_fkey|_check)$'))[1], '');
  return left(n, 63 - length(suffix)) || suffix;
end
$f$;

do $$
declare
  r record;
  g record;
  new_name text;
  new_def text;
  new_oid oid;
  was_dropped boolean;
begin
  -- Tables
  for r in select c.relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname ilike '%topic%' loop
    execute format('alter table public.%I rename to %I', r.relname, pg_temp.to_category_name(r.relname));
  end loop;

  -- Columns (tables, then views, whose output column names do not follow the base column)
  for r in select c.relname, c.relkind, a.attname
           from pg_attribute a join pg_class c on c.oid = a.attrelid
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and a.attnum > 0
             and not a.attisdropped and a.attname ilike '%topic%' loop
    execute format('alter table public.%I rename column %I to %I', r.relname, r.attname, pg_temp.to_category(r.attname));
  end loop;
  for r in select c.relname, a.attname
           from pg_attribute a join pg_class c on c.oid = a.attrelid
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and a.attnum > 0
             and not a.attisdropped and a.attname ilike '%topic%' loop
    execute format('alter view public.%I rename column %I to %I', r.relname, r.attname, pg_temp.to_category(r.attname));
  end loop;

  -- Constraints (renaming a unique/primary key constraint renames its index too)
  for r in select conrelid::regclass::text as rel, conname from pg_constraint
           where connamespace = 'public'::regnamespace and conname ilike '%topic%' loop
    execute format('alter table %s rename constraint %I to %I', r.rel, r.conname, pg_temp.to_category_name(r.conname));
  end loop;

  -- Remaining indexes
  for r in select indexname from pg_indexes where schemaname = 'public' and indexname ilike '%topic%' loop
    execute format('alter index public.%I rename to %I', r.indexname, pg_temp.to_category_name(r.indexname));
  end loop;

  -- Policies
  for r in select tablename, policyname from pg_policies where schemaname = 'public' and policyname ilike '%topic%' loop
    execute format('alter policy %I on public.%I rename to %I', r.policyname, r.tablename, pg_temp.to_category(r.policyname));
  end loop;

  -- Functions
  for r in select p.oid, p.proname, p.proacl, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def
           from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and (p.proname ilike '%topic%' or pg_get_functiondef(p.oid) ilike '%topic%') loop
    new_def := pg_temp.to_category(r.def);
    continue when new_def = r.def;
    was_dropped := false;
    begin
      execute new_def;
    exception when invalid_function_definition then
      execute format('drop function public.%I(%s)', r.proname, r.args);
      execute new_def;
      was_dropped := true;
    end;
    new_name := pg_temp.to_category(r.proname);
    if new_name <> r.proname then
      execute format('drop function public.%I(%s)', r.proname, r.args);
      was_dropped := true;
    end if;
    if was_dropped and r.proacl is not null then
      select p2.oid into new_oid from pg_proc p2
       where p2.pronamespace = 'public'::regnamespace and p2.proname = new_name
         and pg_get_function_identity_arguments(p2.oid) = pg_temp.to_category(r.args);
      execute format('revoke all on function %s from public, anon, authenticated, service_role', new_oid::regprocedure);
      for g in select privilege_type, grantee from aclexplode(r.proacl) loop
        execute format('grant %s on function %s to %s', g.privilege_type, new_oid::regprocedure,
                       case when g.grantee = 0 then 'public' else (select quote_ident(rolname) from pg_roles where oid = g.grantee) end);
      end loop;
    end if;
  end loop;

  -- Comments on tables, columns, views and indexes
  for r in select d.objoid, d.objsubid, d.description, c.relname, c.relkind,
                  (select a.attname from pg_attribute a where a.attrelid = d.objoid and a.attnum = d.objsubid) as colname
           from pg_description d join pg_class c on c.oid = d.objoid
           where d.classoid = 'pg_class'::regclass and c.relnamespace = 'public'::regnamespace
             and d.description ilike '%topic%' loop
    if r.objsubid > 0 then
      execute format('comment on column public.%I.%I is %L', r.relname, r.colname, pg_temp.to_category(r.description));
    else
      execute format('comment on %s public.%I is %L',
                     case r.relkind when 'i' then 'index' when 'v' then 'view' else 'table' end,
                     r.relname, pg_temp.to_category(r.description));
    end if;
  end loop;
end
$$;

-- tracking_runs.run_kind still stores 'topic' for single-category runs; say so in its comment.
comment on column public.tracking_runs.run_kind is
  'Stored value ''topic'' means a single-category run; ''full'' is a legacy all-category run (the word "topic" is kept in stored data).';

-- Self-check: nothing named after "topic" may remain, other than Profound's vocabulary and the stored run_kind literal.
do $$
declare leftovers text;
begin
  select string_agg(x, ', ' order by x) into leftovers from (
    select 'table ' || relname as x from pg_class where relnamespace = 'public'::regnamespace and relname ilike '%topic%' and relname not ilike '%profound_topic%'
    union all select 'column ' || c.relname || '.' || a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v') and a.attnum > 0 and not a.attisdropped and a.attname ilike '%topic%' and a.attname not ilike '%profound_topic%'
    union all select 'constraint ' || conname from pg_constraint where connamespace = 'public'::regnamespace and conname ilike '%topic%'
    union all select 'policy ' || policyname from pg_policies where schemaname = 'public' and policyname ilike '%topic%'
    union all select 'function ' || proname from pg_proc p where pronamespace = 'public'::regnamespace and proname ilike '%topic%'
    union all select 'function body ' || proname from pg_proc p where pronamespace = 'public'::regnamespace and prokind = 'f'
      and regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '''topic''', '', 'gi'), 'profound_topic', '', 'gi') ilike '%topic%'
  ) s;
  if leftovers is not null then raise exception 'topic -> category rename incomplete: %', leftovers; end if;
end
$$;

notify pgrst, 'reload schema';
