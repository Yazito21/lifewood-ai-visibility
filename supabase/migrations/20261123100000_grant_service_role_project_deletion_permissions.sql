-- The permanent deletion RPC runs as service_role (SECURITY INVOKER).
-- Grant only the privileges required by its explicit statements.
-- No privileges are granted to anon or authenticated.
grant update, delete on table public.projects to service_role;
grant delete on table public.prompts to service_role;
grant delete on table public.prompts_backup_20261101 to service_role;
