import { withSupabase } from "npm:@supabase/server@1";

type Role = "superadmin" | "admin" | "viewer";
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

Deno.serve(withSupabase({ auth: "user" }, async (req, ctx) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const body = await req.json();
    const action = String(body?.action ?? "");
    const projectId = String(body?.project_id ?? "").trim();
    const authorization = req.headers.get("Authorization") ?? "";
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!projectId) return json({ error: "Missing project ID. Please reopen this page from a project workspace." }, 400);
    if (!accessToken) return json({ error: "Your session is missing. Please sign in again and retry." }, 401);

    const admin = ctx.supabaseAdmin;
    // Resolve the caller from the verified access token instead of relying on
    // an undocumented ctx.userClaims shape.
    const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
    const callerId = authData?.user?.id ?? "";
    if (authError || !callerId) return json({ error: "Your session is invalid or expired. Please sign in again." }, 401);
    const { data: caller, error: callerError } = await admin.from("profiles")
      .select("id,role").eq("id", callerId).single();
    if (callerError || !caller) return json({ error: "Your account profile could not be loaded." }, 403);
    const isSuperadmin = caller.role === "superadmin";

    const { data: currentMembership } = await admin.from("project_members")
      .select("role").eq("project_id", projectId).eq("user_id", callerId).maybeSingle();
    if (!isSuperadmin && currentMembership?.role !== "admin") {
      return json({ error: "Only project Admins and Superadmins can access account management." }, 403);
    }

    const { data: memberships, error: membershipError } = await admin
      .from("project_members").select("project_id,user_id,role,projects(brand_name)");
    if (membershipError) return json({ error: membershipError.message }, 500);
    const allMemberships: any[] = memberships ?? [];

    let manageableProjectIds: string[];
    let projectOptions: Array<{ id: string; name: string }>;
    if (isSuperadmin) {
      const { data: allProjects, error } = await admin.from("projects").select("id,brand_name").order("brand_name");
      if (error) return json({ error: error.message }, 500);
      projectOptions = (allProjects ?? []).map((p: any) => ({ id: p.id, name: p.brand_name }));
      manageableProjectIds = projectOptions.map(p => p.id);
    } else {
      manageableProjectIds = [...new Set(allMemberships
        .filter(m => m.user_id === callerId && m.role === "admin").map(m => m.project_id))];
      projectOptions = manageableProjectIds.map(id => {
        const membership = allMemberships.find(m => m.project_id === id);
        const project = Array.isArray(membership?.projects) ? membership.projects[0] : membership?.projects;
        return { id, name: project?.brand_name ?? "Project" };
      }).sort((a,b) => a.name.localeCompare(b.name));
    }
    if (!manageableProjectIds.includes(projectId)) {
      return json({ error: "You do not have account-management access to this project." }, 403);
    }

    if (action === "list") {
      const { data: profiles, error } = await admin.from("profiles")
        .select("id,full_name,email,role,is_permanent,created_at").order("full_name");
      if (error) return json({ error: error.message }, 500);
      const visibleIds = isSuperadmin
        ? new Set((profiles ?? []).map((p: any) => p.id))
        : new Set(allMemberships.filter(m => manageableProjectIds.includes(m.project_id)).map(m => m.user_id));
      const rows = (profiles ?? []).filter((p: any) => visibleIds.has(p.id)).map((p: any) => ({
        id: p.id, full_name: p.full_name ?? "", email: p.email ?? "",
        role: p.role as Role, is_permanent: Boolean(p.is_permanent),
        projects: allMemberships.filter(m => m.user_id === p.id &&
          (isSuperadmin || manageableProjectIds.includes(m.project_id))).map(m => {
            const project = Array.isArray(m.projects) ? m.projects[0] : m.projects;
            return { id: m.project_id, name: project?.brand_name ?? "Project", role: m.role as Role };
          }).sort((a: any,b: any) => a.name.localeCompare(b.name)),
      }));
      return json({ users: rows, projects: projectOptions, is_superadmin: isSuperadmin, manageable_project_ids: manageableProjectIds });
    }

    const targetId = String(body?.user_id ?? "");
    const roleInput = String(body?.role ?? "viewer");
    if (roleInput === "superadmin" && !isSuperadmin) return json({ error: "Only a Superadmin can grant the Superadmin role." }, 403);
    const requestedRole: Role = roleInput === "superadmin" && isSuperadmin ? "superadmin" : roleInput === "admin" ? "admin" : "viewer";
    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const requestedProjects = Array.isArray(body?.project_ids)
      ? [...new Set(body.project_ids.map((v: unknown) => String(v)))] : [];

    if (action === "create") {
      if (!name || !email || password.length < 8) return json({ error: "Name, email and a temporary password of at least 8 characters are required." }, 400);
      if (requestedProjects.length === 0) return json({ error: "Assign the new account to at least one project." }, 400);
      if (requestedProjects.some((id: string) => !manageableProjectIds.includes(id))) return json({ error: "You can only assign accounts to projects you manage." }, 403);
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: name },
      });
      if (error || !created.user) return json({ error: error?.message ?? "Unable to create account." }, 400);
      const newId = created.user.id;
      const { error: profileError } = await admin.from("profiles").update({ full_name: name, email, role: requestedRole }).eq("id", newId);
      if (profileError) {
        await admin.auth.admin.deleteUser(newId);
        return json({ error: profileError.message }, 400);
      }
      const { error: assignError } = await admin.from("project_members").insert(
        requestedProjects.map((id: string) => ({ project_id: id, user_id: newId, role: requestedRole }))
      );
      if (assignError) {
        await admin.auth.admin.deleteUser(newId);
        return json({ error: assignError.message }, 400);
      }
      return json({ message: "Account created and assigned to the selected projects." });
    }

    if (!targetId) return json({ error: "A target account is required." }, 400);
    const { data: target, error: targetError } = await admin.from("profiles")
      .select("id,role,is_permanent").eq("id", targetId).maybeSingle();
    if (targetError || !target) return json({ error: "Account not found." }, 404);
    if (!isSuperadmin && target.role === "superadmin") return json({ error: "Admins cannot modify Superadmin accounts." }, 403);
    if (!isSuperadmin && !allMemberships.some(m => m.user_id === targetId && manageableProjectIds.includes(m.project_id))) {
      return json({ error: "This account is outside your project access." }, 403);
    }

    if (action === "update") {
      if (!name || !email) return json({ error: "Name and email are required." }, 400);
      if (password && password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      if (requestedProjects.length === 0 && !isSuperadmin) return json({ error: "Assign the account to at least one project." }, 400);
      if (requestedProjects.some((id: string) => !manageableProjectIds.includes(id))) return json({ error: "You can only assign accounts to projects you manage." }, 403);
      if (targetId === callerId && isSuperadmin && requestedRole !== "superadmin") return json({ error: "You cannot remove your own Superadmin role." }, 403);

      const authUpdate: Record<string, unknown> = { email, user_metadata: { full_name: name } };
      if (password) authUpdate.password = password;
      const { error: authError } = await admin.auth.admin.updateUserById(targetId, authUpdate as any);
      if (authError) return json({ error: authError.message }, 400);
      const { error: profileError } = await admin.from("profiles").update({ full_name: name, email, role: requestedRole }).eq("id", targetId);
      if (profileError) return json({ error: profileError.message }, 400);

      const existingManagedMemberships = allMemberships.filter(m => m.user_id === targetId && manageableProjectIds.includes(m.project_id));
      for (const membership of existingManagedMemberships) {
        if (!requestedProjects.includes(membership.project_id)) {
          const { error } = await admin.from("project_members").delete().eq("project_id", membership.project_id).eq("user_id", targetId);
          if (error) return json({ error: error.message }, 400);
        }
      }
      for (const id of requestedProjects) {
        const { error } = await admin.from("project_members").upsert(
          { project_id: id, user_id: targetId, role: requestedRole }, { onConflict: "project_id,user_id" }
        );
        if (error) return json({ error: error.message }, 400);
      }
      return json({ message: password ? "Account updated and password reset." : "Account updated." });
    }

    if (action === "delete") {
      if (!isSuperadmin) return json({ error: "Only Superadmins can permanently delete accounts." }, 403);
      if (targetId === callerId || target.is_permanent || target.role === "superadmin") return json({ error: "You cannot delete your own account or a Superadmin account." }, 403);
      const { error } = await admin.auth.admin.deleteUser(targetId);
      if (error) return json({ error: error.message }, 400);
      return json({ message: "Account deleted." });
    }

    if (action === "remove_access") {
      if (target.role === "superadmin") return json({ error: "Superadmin project access cannot be removed here." }, 403);
      const projectsToRemove = isSuperadmin ? allMemberships.filter(m => m.user_id === targetId).map(m => m.project_id) : manageableProjectIds;
      for (const id of [...new Set(projectsToRemove)]) {
        const { error } = await admin.from("project_members").delete().eq("user_id", targetId).eq("project_id", id);
        if (error) return json({ error: error.message }, 400);
      }
      return json({ message: "Project access removed." });
    }

    return json({ error: "Unsupported action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
}));
