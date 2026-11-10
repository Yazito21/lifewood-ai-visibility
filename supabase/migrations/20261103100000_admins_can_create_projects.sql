-- Let a platform admin finish creating a project they started.
--
-- Before this, an admin's insert into projects passed the INSERT policy, but the
-- returned row was hidden by the SELECT policy (the admin was not a member yet), so
-- PostgREST reported "new row violates row-level security policy for table projects".
-- Adding themselves to project_members then failed the same way, because only
-- existing project admins could add members. Superadmins were unaffected.
--
-- The creator clause mirrors the one already in can_edit_project(). The SELECT policy
-- checks the row's own columns, because a subquery in the same INSERT statement
-- cannot see the row being inserted.

drop policy if exists "projects visible to members" on public.projects;
create policy "projects visible to members" on public.projects
  for select to authenticated
  using (
    public.is_project_member(id)
    or (created_by = (select auth.uid()) and public.current_app_role() = 'admin')
  );

create or replace function public.can_manage_project_members(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.is_superadmin()
    or exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id and pm.user_id = auth.uid()
        and pm.role in ('admin', 'superadmin')
    )
    or exists (
      select 1 from public.projects p
      where p.id = p_project_id and p.created_by = auth.uid()
        and public.current_app_role() = 'admin'
    )
$function$;
