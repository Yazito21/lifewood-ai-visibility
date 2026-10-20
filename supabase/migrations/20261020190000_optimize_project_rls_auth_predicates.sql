-- Evaluate auth.uid() once per statement rather than once per row in RLS predicates.
DROP POLICY IF EXISTS "projects admins can insert" ON public.projects;
CREATE POLICY "projects admins can insert"
ON public.projects FOR INSERT TO authenticated
WITH CHECK (
  public.is_superadmin()
  OR (
    public.current_app_role() = 'admin'::public.app_role
    AND created_by = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "profiles self or superadmin" ON public.profiles;
CREATE POLICY "profiles self or superadmin"
ON public.profiles FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) OR public.is_superadmin());

DROP POLICY IF EXISTS "Project members can view daily tracking claims" ON public.tracking_run_daily_claims;
CREATE POLICY "Project members can view daily tracking claims"
ON public.tracking_run_daily_claims FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = tracking_run_daily_claims.project_id
      AND pm.user_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role::text = 'superadmin'
  )
);
