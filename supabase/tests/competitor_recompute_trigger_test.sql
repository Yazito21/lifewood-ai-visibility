-- Verifies the competitor-change pipeline end to end WITHOUT keeping any change:
-- the block always ends by raising an exception, which rolls everything back, and prints the observed counts.
-- Expected output: queued_after_alias_change=1 queued_after_more_edits=1 archived_rows>=1 queued_after_noop_resave=0
--
-- Replace the project id to test another project.
do $$
declare
  pid uuid := 'b56434b2-39b6-47fe-b621-4aae99f6bd7c';
  a record; q1 int; q2 int; q3 int; arch int;
begin
  select * into a from public.topic_brand_assignments
  where project_id = pid and role = 'competitor' order by topic, brand_id limit 1;

  -- 1. an alias change on a competitor assignment queues one job
  update public.topic_brand_assignments set aliases = aliases || array['zz test alias']
  where project_id = pid and topic = a.topic and brand_id = a.brand_id;
  select count(*) into q1 from public.competitor_recompute_jobs where project_id = pid and status = 'queued';

  -- 2. further edits in the same window are debounced into the same job; replaced rows are archived
  update public.topic_brand_assignments set include_in_metrics = false
  where project_id = pid and topic = a.topic and brand_id = a.brand_id;
  delete from public.topic_brand_assignments where project_id = pid and topic = a.topic and brand_id = a.brand_id;
  insert into public.topic_brand_assignments (project_id, topic, brand_id, role, aliases, websites, include_in_metrics)
  values (pid, a.topic, a.brand_id, 'competitor', a.aliases, a.websites, true);
  select count(*) into q2 from public.competitor_recompute_jobs where project_id = pid and status = 'queued';
  select count(*) into arch from public.topic_brand_assignments_archive
  where project_id = pid and brand_id = a.brand_id and archived_at >= now() - interval '1 minute';

  -- 3. re-saving an unchanged row (only updated_at) queues nothing new
  delete from public.competitor_recompute_jobs where project_id = pid;
  update public.topic_brand_assignments set updated_at = now()
  where project_id = pid and topic = a.topic and brand_id = a.brand_id;
  select count(*) into q3 from public.competitor_recompute_jobs where project_id = pid and status = 'queued';

  raise exception 'TRIGGER_TEST queued_after_alias_change=% queued_after_more_edits=% archived_rows=% queued_after_noop_resave=%', q1, q2, arch, q3;
end $$;
