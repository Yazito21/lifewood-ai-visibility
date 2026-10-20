-- Project-member management checks are only meaningful for authenticated callers.
-- Remove the default PUBLIC execute grant so anonymous requests cannot probe project permissions.
REVOKE EXECUTE ON FUNCTION public.can_manage_project_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_project_members(uuid) TO authenticated, service_role;
