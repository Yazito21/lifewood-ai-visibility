import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function configuredKey(primary: string, jsonEnv: string, legacy?: string) {
  const direct = Deno.env.get(primary);
  if (direct) return direct;
  if (legacy) {
    const value = Deno.env.get(legacy);
    if (value) return value;
  }
  const raw = Deno.env.get(jsonEnv);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.default ? Deno.env.get(parsed.default) ?? null : null;
  } catch {
    return null;
  }
}

async function collectProjectObjects(
  admin: any,
  bucket: string,
  projectId: string,
) {
  const folders = [projectId];
  const paths: string[] = [];

  while (folders.length) {
    const folder = folders.pop()!;
    let offset = 0;

    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(folder, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error("STORAGE_LIST_FAILED:" + bucket + ":" + error.message);
      if (!data?.length) break;

      for (const item of data) {
        const path = folder + "/" + item.name;
        if (item.id || item.metadata) paths.push(path);
        else folders.push(path);
      }

      if (data.length < 100) break;
      offset += data.length;
    }
  }

  return paths;
}

async function removeProjectStorage(
  admin: any,
  projectId: string,
) {
  // These buckets contain project-owned assets. Client report templates are
  // shared platform assets and must never be removed with an individual project.
  for (const bucket of ["project-brand-logos", "client-report-previews"]) {
    const paths = await collectProjectObjects(admin, bucket, projectId);
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(index, index + 100));
      if (error) throw new Error("STORAGE_DELETE_FAILED:" + bucket + ":" + error.message);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = configuredKey(
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_PUBLISHABLE_KEYS",
    ) ?? Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      ?? configuredKey("SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS");

    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      console.error("DELETE_PROJECT_CONFIG_MISSING", {
        hasUrl: Boolean(supabaseUrl),
        hasPublishableKey: Boolean(publishableKey),
        hasServiceRoleKey: Boolean(serviceRoleKey),
      });
      return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
    }

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\\s+/i, "").trim();
    if (!token) return json({ error: "AUTHORIZATION_TOKEN_MISSING" }, 401);

    const userResponse = await fetch(supabaseUrl + "/auth/v1/user", {
      headers: { apikey: publishableKey, Authorization: "Bearer " + token },
    });
    if (!userResponse.ok) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);

    const user = await userResponse.json();
    const actorId = String(user?.id ?? "");
    if (!actorId) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);

    const body = await req.json();
    const projectId = String(body?.project_id ?? "").trim();
    const confirmedBrandName = String(body?.confirmed_brand_name ?? "");

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
      return json({ error: "INVALID_PROJECT_ID" }, 400);
    }
    if (!confirmedBrandName.trim()) return json({ error: "BRAND_NAME_CONFIRMATION_REQUIRED" }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [
      { data: profile, error: profileError },
      { data: member, error: memberError },
      { data: project, error: projectError },
    ] = await Promise.all([
      admin.from("profiles").select("role").eq("id", actorId).maybeSingle(),
      admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", actorId).maybeSingle(),
      admin.from("projects").select("id,brand_name,created_by").eq("id", projectId).maybeSingle(),
    ]);

    if (profileError || memberError || projectError) {
      console.error("DELETE_PROJECT_LOOKUP_FAILED", {
        profile: profileError?.message ?? null,
        member: memberError?.message ?? null,
        project: projectError?.message ?? null,
      });
      return json({ error: "AUTHORIZATION_LOOKUP_FAILED" }, 500);
    }
    if (!project) return json({ error: "PROJECT_NOT_FOUND" }, 404);

    const authorized = profile?.role === "superadmin"
      || member?.role === "admin"
      || member?.role === "superadmin"
      || (profile?.role === "admin" && project.created_by === actorId);
    if (!authorized) return json({ error: "PROJECT_DELETE_NOT_AUTHORIZED" }, 403);

    if (confirmedBrandName.trim() !== String(project.brand_name ?? "").trim()) {
      return json({ error: "PROJECT_NAME_CONFIRMATION_MISMATCH" }, 400);
    }

    // Remove only files rooted at this exact project UUID. If Storage cleanup
    // fails, do not proceed with the irreversible database deletion.
    try {
      await removeProjectStorage(admin, projectId);
    } catch (error) {
      console.error("DELETE_PROJECT_STORAGE_FAILED", error);
      return json({
        error: "PROJECT_STORAGE_CLEANUP_FAILED",
        message: "Project files could not all be removed. The project database records were not deleted.",
      }, 502);
    }

    const { data: deletion, error: deletionError } = await admin.rpc("delete_project_permanently", {
      p_project_id: projectId,
      p_actor_id: actorId,
      p_confirmed_brand_name: confirmedBrandName.trim(),
    });

    if (deletionError) {
      console.error("DELETE_PROJECT_DATABASE_FAILED", deletionError.message);
      return json({
        error: deletionError.message || "PROJECT_DATABASE_DELETE_FAILED",
        message: "The project database records could not be deleted. Project storage files have already been removed.",
      }, 500);
    }

    return json({
      deleted: true,
      project_id: projectId,
      brand_name: project.brand_name,
      storage_cleanup: "complete",
      database: deletion,
    });
  } catch (error) {
    console.error("DELETE_PROJECT_UNEXPECTED_ERROR", error instanceof Error ? error.message : String(error));
    return json({ error: "UNEXPECTED_DELETE_PROJECT_ERROR" }, 500);
  }
});
