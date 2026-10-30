import { createClient } from "npm:@supabase/supabase-js@2";
import { Zip, ZipDeflate, strToU8 } from "npm:fflate@0.8.2";
import { streamWorkbook, type PromptRow, type ResponseRow } from "./xlsx_stream.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition",
};

// Responses are streamed into the workbook page by page, so memory no longer limits the export; wall-clock time does.
const MAX_RESPONSES = 8000;
const PAGE_SIZE = 150;

function jsonError(error: string, status = 400) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z"));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError("METHOD_NOT_ALLOWED", 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
    if (!supabaseUrl || !serviceKey) return jsonError("SUPABASE_SERVER_CONFIG_MISSING", 500);

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonError("AUTHORIZATION_TOKEN_MISSING", 401);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return jsonError("AUTH_VALIDATION_FAILED", 401);

    const body = await req.json();
    const projectId = String(body?.project_id ?? "");
    const startDate = body?.start_date;
    const endDate = body?.end_date;
    const requestedLocation = typeof body?.tracking_location === "string" ? body.tracking_location : null;
    if (!projectId) return jsonError("PROJECT_ID_REQUIRED");
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) return jsonError("INVALID_DATE_RANGE");

    const [{ data: profile, error: profileError }, { data: member, error: memberError }, { data: project, error: projectError }] = await Promise.all([
      admin.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
      admin.from("projects").select("id,brand_name,tracking_market").eq("id", projectId).maybeSingle(),
    ]);
    if (profileError || memberError || projectError) return jsonError("PROJECT_ACCESS_LOOKUP_FAILED", 500);
    if (!project) return jsonError("PROJECT_NOT_FOUND", 404);
    if (profile?.role !== "superadmin" && !member) return jsonError("PROJECT_ACCESS_DENIED", 403);

    const trackingLocation = requestedLocation ?? project.tracking_market ?? "MY";
    if (trackingLocation !== "LEGACY" && trackingLocation !== "GLOBAL" && !/^[A-Z]{2}$/.test(trackingLocation)) return jsonError("INVALID_TRACKING_LOCATION");
    const startIso = new Date(startDate + "T00:00:00+08:00").toISOString();
    const endExclusiveIso = new Date(new Date(endDate + "T00:00:00+08:00").getTime() + 86400000).toISOString();

    const scoped = () => admin.from("ai_responses")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId).eq("tracking_location", trackingLocation)
      .gte("captured_at", startIso).lt("captured_at", endExclusiveIso);
    const { count, error: countError } = await scoped();
    if (countError) {
      console.error("RAW_EXPORT_COUNT_FAILED", countError.message);
      return jsonError("RAW_RESPONSE_EXPORT_QUERY_FAILED", 500);
    }
    if ((count ?? 0) > MAX_RESPONSES) return jsonError("EXPORT_TOO_LARGE_NARROW_THE_DATE_RANGE", 413);

    const promptRows: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await admin.from("prompts")
        .select("id,prompt_number,prompt,topic,language")
        .eq("project_id", projectId)
        .order("prompt_number", { ascending: true })
        .range(offset, offset + 499);
      if (error) return jsonError("PROMPT_METADATA_QUERY_FAILED", 500);
      promptRows.push(...(data ?? []) as Array<Record<string, unknown>>);
      if (!data || data.length < 500) break;
    }
    const prompts = new Map<string, PromptRow>(promptRows.map((prompt) => [String(prompt.id), prompt]));

    const columns = {
      full: "id,project_id,prompt_id,llm_provider,captured_at,prompt_snapshot,raw_response,response_text,response_status,error_message,run_id,brand_name_snapshot,tracking_location",
      raw: "id,prompt_id,captured_at,raw_response",
    };
    async function* pages(kind: "full" | "raw"): AsyncGenerator<ResponseRow[]> {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        // The id tiebreak keeps paging stable when many responses share a capture time (imported data does).
        const { data, error } = await admin.from("ai_responses")
          .select(columns[kind])
          .eq("project_id", projectId).eq("tracking_location", trackingLocation)
          .gte("captured_at", startIso).lt("captured_at", endExclusiveIso)
          .order("captured_at", { ascending: true }).order("id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw new Error("RAW_RESPONSE_EXPORT_QUERY_FAILED: " + error.message);
        const rows = (data ?? []) as unknown as ResponseRow[];
        if (rows.length) yield rows;
        if (rows.length < PAGE_SIZE) break;
      }
    }

    const stream = streamWorkbook({ Zip, ZipDeflate, strToU8 }, { pages, prompts }, {
      brandName: String(project.brand_name ?? "Project"), projectId, trackingLocation, startDate, endDate,
    });
    const filenameBrand = String(project.brand_name ?? "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
    const filename = filenameBrand + "-raw-responses-" + startDate + "-to-" + endDate + ".xlsx";
    return new Response(stream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=\"" + filename + "\"",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("RAW_RESPONSE_EXPORT_FAILED", error instanceof Error ? error.message : String(error));
    return jsonError("RAW_RESPONSE_EXPORT_FAILED", 500);
  }
});
