-- Seed one legacy category run before the terminology migration is applied.
-- The later schema contract verifies this row is converted to run_kind='category'.
do $$
declare
  v_project uuid;
begin
  insert into public.projects (brand_name, categories, tracking_market, tracking_locations)
  values ('Replacement Rerun Legacy Run Kind Migration Fixture', array['Skin'], 'MY', array['MY'])
  returning id into v_project;

  insert into public.tracking_runs (
    project_id, provider, status, total_prompts, completed_prompts,
    started_at, tracking_location, category, run_kind
  ) values (
    v_project, 'chatgpt', 'failed', 0, 0, now(), 'MY', 'Skin', 'topic'
  );
end
$$;
