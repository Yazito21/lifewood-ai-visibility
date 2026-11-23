-- Permanently delete a project and every project-owned database record.
-- Storage objects are removed by the delete-project Edge Function before this
-- transaction is called. This function is intentionally SECURITY INVOKER and
-- executable only by service_role; the Edge Function authenticates and authorizes
-- the caller, and this function independently rechecks the actor and exact name.

create or replace function public.delete_project_permanently(
  p_project_id uuid,
  p_actor_id uuid,
  p_confirmed_brand_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_brand_name text;
  v_created_by uuid;
  v_profile_role text;
  v_member_role text;
  v_deleted_count integer;
begin
  if p_project_id is null or p_actor_id is null then
    raise exception 'PROJECT_AND_ACTOR_REQUIRED' using errcode = '22023';
  end if;

  select p.brand_name, p.created_by
    into v_brand_name, v_created_by
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select pr.role::text
    into v_profile_role
  from public.profiles pr
  where pr.id = p_actor_id;

  select pm.role::text
    into v_member_role
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = p_actor_id;

  if coalesce(v_profile_role, '') <> 'superadmin'
     and coalesce(v_member_role, '') not in ('admin', 'superadmin')
     and not (v_profile_role = 'admin' and v_created_by = p_actor_id) then
    raise exception 'PROJECT_DELETE_NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_confirmed_brand_name is distinct from v_brand_name then
    raise exception 'PROJECT_NAME_CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;

  -- ai_responses.project_id uses ON DELETE SET NULL for historical compatibility.
  -- Remove rows by project and by project-owned prompts before deleting the project.
  delete from public.ai_responses ar
  where ar.project_id = p_project_id
     or ar.prompt_id in (
       select pr.id from public.prompts pr where pr.project_id = p_project_id
     );

  -- Legacy/archive tables intentionally have no project FK, so clean them explicitly.
  delete from public.category_brand_assignments_archive
  where project_id = p_project_id;

  delete from public.category_brand_observations_archive
  where project_id = p_project_id;

  delete from public.prompts_backup_20261101
  where project_id = p_project_id;

  -- Break same-project self references before the project FK cascades tracking_runs.
  update public.tracking_runs
  set source_run_id = null
  where project_id = p_project_id
    and source_run_id is not null;

  delete from public.projects
  where id = p_project_id;

  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> 1 then
    raise exception 'PROJECT_DELETE_FAILED' using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'deleted', true,
    'project_id', p_project_id,
    'brand_name', v_brand_name
  );
end;
$function$;

revoke all on function public.delete_project_permanently(uuid, uuid, text) from public;
revoke all on function public.delete_project_permanently(uuid, uuid, text) from anon, authenticated;
grant execute on function public.delete_project_permanently(uuid, uuid, text) to service_role;
