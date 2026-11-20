-- READ-ONLY foreign-key dependency inventory for tracking_runs.
-- This query identifies child references and ON DELETE behaviour; it does not mutate data.
select
  conrelid::regclass::text as referencing_table,
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition,
  case confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else confdeltype::text
  end as on_delete
from pg_constraint
where contype = 'f'
  and confrelid = 'public.tracking_runs'::regclass
order by referencing_table, constraint_name;
