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

function getConfiguredKey(primary: string, jsonEnv: string, legacy?: string) {
  const direct = Deno.env.get(primary);
  if (direct) return direct;
  if (legacy) {
    const legacyValue = Deno.env.get(legacy);
    if (legacyValue) return legacyValue;
  }
  const raw = Deno.env.get(jsonEnv);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const name = parsed?.default;
    return name ? (Deno.env.get(name) ?? null) : null;
  } catch {
    return null;
  }
}

function b64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function encrypt(value: string, aad: string) {
  const secret = getConfiguredKey("SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("SERVER_SECRET_UNAVAILABLE");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(value),
  );
  return b64(iv) + "." + b64(new Uint8Array(ciphertext));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey =
      getConfiguredKey(
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_PUBLISHABLE_KEYS"
      ) ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !publishableKey) {
      console.error("SUPABASE_CLIENT_CONFIG_MISSING", {
        hasUrl: Boolean(supabaseUrl),
        hasPublishableKey: Boolean(publishableKey),
      });
      return json({ error: "SUPABASE_CLIENT_CONFIG_MISSING" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "AUTHORIZATION_TOKEN_MISSING" }, 401);

    // Validate the current browser session directly against Supabase Auth.
    const userResponse = await fetch(
      supabaseUrl + "/auth/v1/user",
      {
        headers: {
          apikey: publishableKey,
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!userResponse.ok) {
      const detail = await userResponse.text();
      console.error("AUTH_VALIDATION_FAILED", userResponse.status, detail.slice(0, 200));
      return json({ error: "AUTH_VALIDATION_FAILED", status: userResponse.status }, 401);
    }

    const user = await userResponse.json();
    const userId = user?.id;
    if (!userId) return json({ error: "AUTH_USER_MISSING" }, 401);

    const secretKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      getConfiguredKey(
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SECRET_KEYS"
      );
    if (!secretKey) return json({ error: "SUPABASE_SERVER_KEY_MISSING" }, 500);

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();
    const action = String(body?.action || "");
    const projectId = String(body?.project_id || "");
    const provider = String(body?.provider || "");

    if (!projectId || !provider) return json({ error: "Missing project or provider." }, 400);

    const [{ data: profile, error: profileError }, { data: member, error: memberError }] =
      await Promise.all([
        admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
        admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle(),
      ]);

    if (profileError || memberError) {
      console.error("AUTHZ_QUERY_FAILED", JSON.stringify({
        profile: profileError?.message ?? null,
        member: memberError?.message ?? null,
      }));
      return json({ error: "AUTHORIZATION_LOOKUP_FAILED" }, 500);
    }

    const isAdmin =
      profile?.role === "superadmin" ||
      profile?.role === "admin" ||
      member?.role === "superadmin" ||
      member?.role === "admin";

    if (!isAdmin) return json({ error: "Not authorized." }, 403);

    const allowed = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "claude"];
    if (!allowed.includes(provider)) return json({ error: "Unsupported provider." }, 400);

    if (action === "set") {
      const value = String(body?.api_key || "").trim();
      if (value.length < 8) return json({ error: "API key is too short." }, 400);

      const now = new Date().toISOString();
      const ciphertext = await encrypt(value, projectId + ":" + provider);

      const { error: secretError } = await admin.from("llm_secrets").upsert(
        { project_id: projectId, provider, ciphertext, key_last4: value.slice(-4), updated_at: now },
        { onConflict: "project_id,provider" },
      );
      if (secretError) {
        console.error("SECRET_WRITE_FAILED", secretError.message);
        return json({ error: "SECRET_WRITE_FAILED" }, 500);
      }

      const { error: configError } = await admin.from("llm_configs").upsert(
        { project_id: projectId, provider, enabled: true, api_key_last4: value.slice(-4), key_updated_at: now },
        { onConflict: "project_id,provider" },
      );
      if (configError) {
        console.error("CONFIG_WRITE_FAILED", configError.message);
        return json({ error: "CONFIG_WRITE_FAILED" }, 500);
      }

      return json({ message: "API key saved securely.", last4: value.slice(-4) });
    }

    if (action === "remove") {
      const { error: secretError } = await admin.from("llm_secrets")
        .delete().eq("project_id", projectId).eq("provider", provider);
      if (secretError) return json({ error: "SECRET_DELETE_FAILED" }, 500);

      const { error: configError } = await admin.from("llm_configs")
        .update({ enabled: false, api_key_last4: null, key_updated_at: null })
        .eq("project_id", projectId).eq("provider", provider);
      if (configError) return json({ error: "CONFIG_UPDATE_FAILED" }, 500);

      return json({ message: "API key removed." });
    }

    return json({ error: "Unsupported action." }, 400);
  } catch (error) {
    console.error("FUNCTION_ERROR", error instanceof Error ? error.message : String(error));
    return json({ error: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});