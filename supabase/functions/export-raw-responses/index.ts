import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition",
};

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

function splitText(value: string, maxLength = 30000) {
  if (!value) return [""];
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += maxLength) parts.push(value.slice(i, i + maxLength));
  return parts;
}

function extractCitationLinks(raw: unknown, responseText: string) {
  const candidates: Array<{ url: string; title: string; source: string }> = [];
  const payload = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content as Array<Record<string, unknown>>) {
        if (Array.isArray(content.annotations)) {
          for (const annotation of content.annotations as Array<Record<string, unknown>>) {
            if (annotation.type === "url_citation" && typeof annotation.url === "string") {
              candidates.push({ url: annotation.url, title: String(annotation.title ?? ""), source: "url_citation" });
            }
          }
        }
      }
    }
    if (item.type === "web_search_call" && item.action && typeof item.action === "object") {
      const action = item.action as Record<string, unknown>;
      if (Array.isArray(action.sources)) {
        for (const source of action.sources as Array<Record<string, unknown>>) {
          if (typeof source.url === "string") candidates.push({ url: source.url, title: String(source.title ?? ""), source: "web_search_source" });
        }
      }
    }
  }
  const fallbackUrls = responseText.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  for (const url of fallbackUrls) candidates.push({ url: url.replace(/[.,;:!?]+$/, ""), title: "", source: "response_text_url" });
  const unique = new Map<string, { url: string; title: string; source: string; domain: string }>();
  for (const candidate of candidates) {
    if (!candidate.url.startsWith("http://") && !candidate.url.startsWith("https://")) continue;
    if (!unique.has(candidate.url)) {
      let domain = "";
      try { domain = new URL(candidate.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* invalid URL */ }
      unique.set(candidate.url, { ...candidate, domain });
    }
  }
  return [...unique.values()];
}

function safeSheetText(value: string) {
  return value.length <= 32767 ? value : value.slice(0, 30000) + "\n[Truncated in this cell; see the corresponding chunks sheet for the complete value.]";
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
    if (!projectId) return jsonError("PROJECT_ID_REQUIRED");
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) return jsonError("INVALID_DATE_RANGE");

    const [{ data: profile, error: profileError }, { data: member, error: memberError }, { data: project, error: projectError }] = await Promise.all([
      admin.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
      admin.from("projects").select("id,brand_name").eq("id", projectId).maybeSingle(),
    ]);
    if (profileError || memberError || projectError) return jsonError("PROJECT_ACCESS_LOOKUP_FAILED", 500);
    if (!project) return jsonError("PROJECT_NOT_FOUND", 404);
    if (profile?.role !== "superadmin" && !member) return jsonError("PROJECT_ACCESS_DENIED", 403);

    const startIso = new Date(startDate + "T00:00:00+08:00").toISOString();
    const endExclusiveIso = new Date(new Date(endDate + "T00:00:00+08:00").getTime() + 86400000).toISOString();
    const responses: Array<Record<string, unknown>> = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin.from("ai_responses")
        .select("id,project_id,prompt_id,llm_provider,captured_at,prompt_snapshot,raw_response,response_text,response_status,error_message,run_id,brand_name_snapshot")
        .eq("project_id", projectId)
        .gte("captured_at", startIso)
        .lt("captured_at", endExclusiveIso)
        .order("captured_at", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) {
        console.error("RAW_EXPORT_RESPONSE_QUERY_FAILED", error.message);
        return jsonError("RAW_RESPONSE_EXPORT_QUERY_FAILED", 500);
      }
      responses.push(...(data ?? []) as Array<Record<string, unknown>>);
      if (!data || data.length < pageSize) break;
      if (responses.length >= 100000) return jsonError("EXPORT_TOO_LARGE_NARROW_THE_DATE_RANGE", 413);
    }

    const promptRows: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin.from("prompts")
        .select("id,prompt_number,prompt,topic,language")
        .eq("project_id", projectId)
        .order("prompt_number", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) return jsonError("PROMPT_METADATA_QUERY_FAILED", 500);
      promptRows.push(...(data ?? []) as Array<Record<string, unknown>>);
      if (!data || data.length < pageSize) break;
    }
    const promptsById = new Map(promptRows.map((prompt) => [String(prompt.id), prompt]));
    const enriched = responses.map((row) => {
      const prompt = promptsById.get(String(row.prompt_id ?? ""));
      const text = String(row.response_text ?? "");
      const rawJson = row.raw_response == null ? "" : JSON.stringify(row.raw_response);
      const citations = extractCitationLinks(row.raw_response, text);
      return { row, prompt, text, rawJson, citations };
    });

    const citationRows = enriched.flatMap(({ row, prompt, citations }) => citations.map((citation) => ({
      Response_ID: String(row.id ?? ""),
      Captured_At: String(row.captured_at ?? ""),
      Run_ID: String(row.run_id ?? ""),
      Prompt_No: prompt?.prompt_number ?? "",
      Prompt_ID: String(row.prompt_id ?? ""),
      Prompt: String(row.prompt_snapshot ?? prompt?.prompt ?? ""),
      Topic: String(prompt?.topic ?? ""),
      Language: String(prompt?.language ?? ""),
      Engine: String(row.llm_provider ?? ""),
      Citation_Title: citation.title,
      Citation_URL: citation.url,
      Domain: citation.domain,
      Citation_Source: citation.source,
    })));

    const maxCellLength = 30000;
    const responseRows = enriched.map(({ row, prompt, text, rawJson, citations }) => ({
      Response_ID: String(row.id ?? ""),
      Captured_At: String(row.captured_at ?? ""),
      Run_ID: String(row.run_id ?? ""),
      Prompt_No: prompt?.prompt_number ?? "",
      Prompt_ID: String(row.prompt_id ?? ""),
      Prompt: String(row.prompt_snapshot ?? prompt?.prompt ?? ""),
      Topic: String(prompt?.topic ?? ""),
      Language: String(prompt?.language ?? ""),
      Engine: String(row.llm_provider ?? ""),
      Status: String(row.response_status ?? ""),
      Error: String(row.error_message ?? ""),
      "Response Text (full if <= 30,000 chars)": safeSheetText(text),
      "Raw Response JSON (full if <= 30,000 chars)": safeSheetText(rawJson),
      Response_Text_Characters: text.length,
      Raw_JSON_Characters: rawJson.length,
      Citation_Count: citations.length,
      Citation_URLs: citations.map((citation) => citation.url).join("\n"),
      "Complete Text In Chunks Sheet": text.length > maxCellLength ? "Yes" : "No",
      "Complete JSON In Chunks Sheet": rawJson.length > maxCellLength ? "Yes" : "No",
    }));

    const textChunks: unknown[][] = [["Response_ID", "Prompt_No", "Captured_At", "Chunk_No", "Total_Chunks", "Response_Text_Chunk"]];
    const jsonChunks: unknown[][] = [["Response_ID", "Prompt_No", "Captured_At", "Chunk_No", "Total_Chunks", "Raw_JSON_Chunk"]];
    for (const { row, prompt, text, rawJson } of enriched) {
      if (text.length > maxCellLength) {
        const chunks = splitText(text);
        chunks.forEach((chunk, index) => textChunks.push([String(row.id ?? ""), prompt?.prompt_number ?? "", String(row.captured_at ?? ""), index + 1, chunks.length, chunk]));
      }
      if (rawJson.length > maxCellLength) {
        const chunks = splitText(rawJson);
        chunks.forEach((chunk, index) => jsonChunks.push([String(row.id ?? ""), prompt?.prompt_number ?? "", String(row.captured_at ?? ""), index + 1, chunks.length, chunk]));
      }
    }

    const completed = responses.filter((row) => row.response_status === "completed").length;
    const failed = responses.filter((row) => row.response_status === "failed").length;
    const summary = [
      ["Field", "Value"],
      ["Project", String(project.brand_name ?? "Project")],
      ["Project ID", projectId],
      ["Period Start (Malaysia Time)", startDate],
      ["Period End (Malaysia Time)", endDate],
      ["Exported At (UTC)", new Date().toISOString()],
      ["Total Raw Responses", responses.length],
      ["Completed Responses", completed],
      ["Failed Responses", failed],
      ["Other Statuses", responses.length - completed - failed],
      ["Distinct Prompts", new Set(responses.map((row) => String(row.prompt_id ?? ""))).size],
      ["Citation Links Extracted From Raw Responses", citationRows.length],
      ["Notes", "Raw Responses includes response text and raw JSON. Values exceeding Excel's cell character limit are complete in the corresponding chunk sheets; reassemble chunks in ascending Chunk_No by Response_ID."],
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), "Summary");
    const responseHeaders = Object.keys(responseRows[0] ?? {
      Response_ID: "", Captured_At: "", Run_ID: "", Prompt_No: "", Prompt_ID: "", Prompt: "",
      Topic: "", Language: "", Engine: "", Status: "", Error: "", "Response Text (full if <= 30,000 chars)": "",
      "Raw Response JSON (full if <= 30,000 chars)": "", Response_Text_Characters: 0, Raw_JSON_Characters: 0,
      Citation_Count: 0, Citation_URLs: "", "Complete Text In Chunks Sheet": "", "Complete JSON In Chunks Sheet": "",
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([responseHeaders, ...responseRows.map((row) => responseHeaders.map((key) => (row as Record<string, unknown>)[key] ?? ""))]), "Raw Responses");
    const citationHeaders = ["Response_ID", "Captured_At", "Run_ID", "Prompt_No", "Prompt_ID", "Prompt", "Topic", "Language", "Engine", "Citation_Title", "Citation_URL", "Domain", "Citation_Source"];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([citationHeaders, ...citationRows.map((row) => citationHeaders.map((key) => (row as Record<string, unknown>)[key] ?? ""))]), "Citation Links");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(textChunks), "Response Text Chunks");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(jsonChunks), "Raw JSON Chunks");

    const filenameBrand = String(project.brand_name ?? "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
    const filename = filenameBrand + "-raw-responses-" + startDate + "-to-" + endDate + ".xlsx";
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true }) as Uint8Array;
    return new Response(bytes, {
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