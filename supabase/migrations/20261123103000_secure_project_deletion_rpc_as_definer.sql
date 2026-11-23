-- Run the narrowly scoped deletion routine with its postgres owner privileges.
-- The routine already performs explicit profile/project-role authorization checks,
-- verifies the exact brand-name confirmation, and uses fully qualified table names.
-- The empty search_path prevents object-shadowing attacks.
alter function public.delete_project_permanently(uuid, uuid, text) security definer;
alter function public.delete_project_permanently(uuid, uuid, text) set search_path = '';

-- Do not expose this destructive RPC to browser-authenticated roles.
revoke all on function public.delete_project_permanently(uuid, uuid, text) from public;
revoke all on function public.delete_project_permanently(uuid, uuid, text) from anon;
revoke all on function public.delete_project_permanently(uuid, uuid, text) from authenticated;
grant execute on function public.delete_project_permanently(uuid, uuid, text) to service_role;
