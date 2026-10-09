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
    return parsed?.default ? (Deno.env.get(parsed.default) ?? null) : null;
  } catch { return null; }
}
function fromB64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function decrypt(ciphertext: string, aad: string) {
  const secret = getConfiguredKey("SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("SERVER_SECRET_UNAVAILABLE");
  const [ivText, encryptedText] = ciphertext.split(".");
  if (!ivText || !encryptedText) throw new Error("INVALID_STORED_SECRET");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivText), additionalData: new TextEncoder().encode(aad) },
    key, fromB64(encryptedText),
  );
  return new TextDecoder().decode(plain);
}
function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function containsTerm(text: string, terms: string[]) {
  const normalized = text.toLocaleLowerCase();
  return terms.some((term) => term.trim().length > 1 && normalized.includes(term.trim().toLocaleLowerCase()));
}
function urlsIn(text: string) {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?]+$/, "")))].slice(0, 40);
}
function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}
function titleFromUrl(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, "").split(".").slice(0, -1).join(".").replace(/[-_]/g, " "); } catch { return url; }
}
async function callChatGPT(apiKey: string, prompt: string, project: Record<string, unknown>) {
  const brand = String(project.brand_name ?? "");
  const description = String(project.brand_description ?? "");
  const domains = Array.isArray(project.brand_domains) ? project.brand_domains.join(", ") : "";
  const system = "You are an impartial research assistant. Answer the user's question directly and naturally. Research the question using web search, and support factual claims with sources you actually consulted. Do not invent URLs, citations, quotes, or claim a source supports a claim unless verified. Mention the tracked brand only when relevant.";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        tools: [{ type: "web_search" }],
        include: ["web_search_call.action.sources"],
        temperature: 0.2,
        input: [
          { role: "system", content: [{ type: "input_text", text: system + (brand ? "\\nTracked brand context (use only if relevant): " + brand + (description ? " — " + description : "") + (domains ? ". Official domains: " + domains : "") : "") }] },
          { role: "user", content: [{ type: "input_text", text: prompt }] },
        ],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || "OpenAI Responses API request failed (" + response.status + ")";
      throw new Error(message.slice(0, 500));
    }
    const textParts: string[] = [];
    const citations: Array<{ url: string; title: string; source: string }> = [];
    for (const item of (Array.isArray(payload?.output) ? payload.output : [])) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (content?.type === "output_text" && typeof content.text === "string") textParts.push(content.text);
          for (const annotation of (Array.isArray(content?.annotations) ? content.annotations : [])) {
            if (annotation?.type === "url_citation" && typeof annotation.url === "string") citations.push({ url: annotation.url, title: String(annotation.title ?? ""), source: "url_citation" });
          }
        }
      }
      if (item?.type === "web_search_call" && Array.isArray(item?.action?.sources)) {
        for (const source of item.action.sources) if (typeof source?.url === "string") citations.push({ url: source.url, title: String(source.title ?? ""), source: "web_search_source" });
      }
    }
    const uniqueCitations = [...new Map(citations.filter(c => c.url.startsWith("http://") || c.url.startsWith("https://")).map(c => [c.url, c])).values()];
    return { text: textParts.join("\\n\\n"), raw: payload, model: payload?.model ?? "gpt-4o-mini", citations: uniqueCitations };
  } finally { clearTimeout(timeout); }
}
async function processPrompts(prompts: Array<Record<string, unknown>>, providers: string[], project: Record<string, unknown>, apiKeys: Record<string,string>) {
  const tasks: Array<{ provider: string; prompt: Record<string,unknown> }> = [];
  for (const provider of providers) {
    if (provider !== "chatgpt") throw new Error("Only ChatGPT is enabled in this first tracking stage. Configure ChatGPT in Settings.");
    if (!apiKeys[provider]) throw new Error("No API key is configured for " + provider + ".");
    for (const prompt of prompts) tasks.push({ provider, prompt });
  }
  const results: Array<Record<string, unknown> | undefined> = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      const { provider, prompt } = tasks[index];
      const started = new Date().toISOString();
      try {
        const answer = await callChatGPT(apiKeys[provider], String(prompt.prompt ?? ""), project);
        const text = answer.text;
        const brandName = String(project.brand_name ?? "");
        const terms = [brandName, ...(Array.isArray(project.brand_terms) ? project.brand_terms.map(String) : [])].filter(Boolean);
        const brandMentioned = containsTerm(text, terms);
        const responseCitations = Array.isArray(answer.citations) ? answer.citations : [];
        const fallbackUrls = urlsIn(text).map((url) => ({ url, title: "", source: "response_text_url" }));
        const citationCandidates = [...responseCitations, ...fallbackUrls];
        const domains = Array.isArray(project.brand_domains) ? project.brand_domains.map((d) => String(d).toLowerCase().replace("https://","").replace("http://","").replace("www.","").split("/")[0]) : [];
        const citations = [...new Map(citationCandidates.filter((c) => c.url.startsWith("http://") || c.url.startsWith("https://")).map((c) => [c.url, c])).values()].map((source) => {
          const url = String(source.url);
          const host = hostOf(url);
          const related = domains.some((d) => d && (host === d || host.endsWith("." + d))) || containsTerm(url, terms);
          return { url, page_name: String(source.title || titleFromUrl(url)), brand_name: related ? brandName : titleFromUrl(url), is_brand_related: related, domain: host, citation_source: source.source ?? "web_search" };
        });
        const competitorHosts = [...new Set(citations.filter((c) => !c.is_brand_related).map((c) => hostOf(c.url)).filter(Boolean))];
        results[index] = {
          prompt_id: prompt.id, prompt_number: prompt.prompt_number, prompt: String(prompt.prompt ?? ""),
          topic: String(prompt.topic ?? "General"), language: String(prompt.language ?? "English"),
          provider, status: "completed", response_text: text, raw_response: answer.raw,
          brand_mentioned: brandMentioned, citations, competitor_hosts: competitorHosts,
          model: answer.model, started_at: started, completed_at: new Date().toISOString(), usage: answer.raw?.usage ?? null,
        };
      } catch (error) {
        results[index] = {
          prompt_id: prompt.id, prompt_number: prompt.prompt_number, prompt: String(prompt.prompt ?? ""),
          topic: String(prompt.topic ?? "General"), language: String(prompt.language ?? "English"),
          provider, status: "failed", error_message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          brand_mentioned: false, citations: [], competitor_hosts: [], started_at: started, completed_at: new Date().toISOString(),
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, tasks.length) }, () => worker()));
  return results.filter((r): r is Record<string,unknown> => Boolean(r));
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let activeRunId: string | null = null;
  let activeAdmin: any = null;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publicKey = getConfiguredKey("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? getConfiguredKey("SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS");
    if (!supabaseUrl || !publicKey || !adminKey) return json({ error: "SUPABASE_SERVER_CONFIG_MISSING" }, 500);
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "AUTHORIZATION_TOKEN_MISSING" }, 401);
    const auth = await fetch(supabaseUrl + "/auth/v1/user", { headers: { apikey: publicKey, Authorization: "Bearer " + token } });
    if (!auth.ok) return json({ error: "AUTH_VALIDATION_FAILED" }, 401);
    const user = await auth.json();
    const userId = user?.id;
    if (!userId) return json({ error: "AUTH_USER_MISSING" }, 401);
    const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
    activeAdmin = admin;
    const body = await req.json();
    const projectId = String(body?.project_id ?? "");
    const mode = body?.mode === "sample" ? "sample" : "persistent";
    if (!projectId) return json({ error: "PROJECT_ID_REQUIRED" }, 400);

    const [{ data: profile, error: profileError }, { data: member, error: memberError }, { data: project, error: projectError }] = await Promise.all([
      admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
      admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle(),
      admin.from("projects").select("id,brand_name,brand_description,brand_domains,brand_terms,topics").eq("id", projectId).maybeSingle(),
    ]);
    if (profileError || memberError || projectError) {
      console.error("PROJECT_ACCESS_LOOKUP_FAILED", JSON.stringify({
        profile: profileError ? { code: profileError.code, message: profileError.message } : null,
        member: memberError ? { code: memberError.code, message: memberError.message } : null,
        project: projectError ? { code: projectError.code, message: projectError.message } : null,
      }));
      return json({ error: "PROJECT_ACCESS_LOOKUP_FAILED", details: {
        profile: profileError ? { code: profileError.code, message: profileError.message } : null,
        member: memberError ? { code: memberError.code, message: memberError.message } : null,
        project: projectError ? { code: projectError.code, message: projectError.message } : null,
      } }, 500);
    }
    if (!project) return json({ error: "PROJECT_NOT_FOUND" }, 404);
    const isAdmin = profile?.role === "superadmin" || profile?.role === "admin" || member?.role === "superadmin" || member?.role === "admin";
    const canAccessProject = profile?.role === "superadmin" || Boolean(member);
    if (mode === "sample" && !canAccessProject) return json({ error: "NOT_AUTHORIZED_FOR_PROJECT" }, 403);
    if (mode !== "sample" && !isAdmin) return json({ error: "NOT_AUTHORIZED_TO_RUN_TRACKING" }, 403);

    const providerIds = Array.isArray(body?.providers) ? [...new Set(body.providers.map(String))] : ["chatgpt"];
    const validProviders = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "claude"];
    if (!providerIds.length || providerIds.some((p) => !validProviders.includes(p))) return json({ error: "INVALID_PROVIDERS" }, 400);
    if (providerIds.some((p) => p !== "chatgpt")) return json({ error: "CHATGPT_ONLY_IN_INITIAL_RELEASE", supported_providers: ["chatgpt"] }, 400);

    let promptQuery = admin.from("prompts").select("id,prompt_number,prompt,topic,language,active").eq("project_id", projectId).eq("active", true).order("prompt_number");
    if (Array.isArray(body?.prompt_ids)) {
      const ids = body.prompt_ids.map(String).filter(Boolean);
      if (!ids.length) return json({ error: "SELECT_AT_LEAST_ONE_PROMPT" }, 400);
      if (ids.length > (mode === "sample" ? 25 : 100)) return json({ error: mode === "sample" ? "SAMPLE_LIMIT_25_PROMPTS" : "TRACKING_LIMIT_100_PROMPTS" }, 400);
      promptQuery = promptQuery.in("id", ids);
    } else if (mode === "sample") {
      return json({ error: "SAMPLE_PROMPTS_REQUIRED" }, 400);
    }
    const { data: prompts, error: promptsError } = await promptQuery;
    if (promptsError) return json({ error: "PROMPT_LOAD_FAILED" }, 500);
    if (!prompts?.length) return json({ error: "NO_ACTIVE_PROMPTS" }, 400);
    if (mode === "sample" && prompts.length > 25) return json({ error: "SAMPLE_LIMIT_25_PROMPTS" }, 400);

    const { data: secret, error: secretError } = await admin.from("llm_secrets").select("ciphertext").eq("project_id", projectId).eq("provider", "chatgpt").maybeSingle();
    if (secretError) return json({ error: "API_KEY_LOOKUP_FAILED" }, 500);
    if (!secret?.ciphertext) return json({ error: "CHATGPT_API_KEY_NOT_CONFIGURED" }, 400);
    const apiKey = await decrypt(secret.ciphertext, projectId + ":chatgpt");
    let runId: string | null = null;
    if (mode !== "sample") {
      runId = crypto.randomUUID();
      const { data: claimRows, error: claimError } = await admin.rpc("claim_daily_tracking_run", {
        p_project_id: projectId,
        p_started_by: userId,
        p_run_id: runId,
        p_total_prompts: prompts.length,
      });
      if (claimError) {
        console.error("DAILY_TRACKING_CLAIM_FAILED", claimError.message);
        return json({ error: "DAILY_TRACKING_CLAIM_FAILED", message: "Could not reserve today's tracking run. Please contact an administrator." }, 500);
      }
      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
      if (!claim?.claimed) {
        const nextDate = claim?.run_date
          ? new Date(new Date(String(claim.run_date) + "T00:00:00+08:00").getTime() + 24 * 60 * 60 * 1000).toISOString()
          : null;
        return json({
          error: "DAILY_TRACKING_LIMIT_REACHED",
          message: "A full tracking run has already been started for this project today (Malaysia Time). Try again after midnight MYT.",
          run_id: claim?.run_id ?? null,
          status: claim?.status ?? "unknown",
          started_at: claim?.started_at ?? null,
          run_date: claim?.run_date ?? null,
          next_available_at: nextDate,
        }, 409);
      }
      activeRunId = runId;
    }
    const results = await processPrompts(prompts as Array<Record<string,unknown>>, providerIds, project as Record<string,unknown>, { chatgpt: apiKey });
    const succeeded = results.filter((r) => r.status === "completed");
    const failed = results.filter((r) => r.status === "failed");

    // Sample mode returns data only to this request. It does not create runs or write result data.
    if (mode === "sample") {
      const total = results.length || 1;
      const brandCount = succeeded.filter((r) => r.brand_mentioned).length;
      const competitors = new Map<string, number>();
      for (const result of succeeded) for (const host of result.competitor_hosts as string[]) competitors.set(host, (competitors.get(host) ?? 0) + 1);
      const brandRank = 1 + [...competitors.values()].filter((count) => count > brandCount).length;
      const allCitations = succeeded.flatMap((r) => (r.citations as Array<Record<string,unknown>>).map((c) => ({ ...c, topic: r.topic, prompt: r.prompt, prompt_number: r.prompt_number, provider: r.provider })));
      return json({
        mode, project: { brand_name: project.brand_name }, providers: providerIds,
        summary: { total_prompts: results.length, completed: succeeded.length, failed: failed.length, visibility_score: Math.round(brandCount / total * 1000) / 10, visibility_rank: brandRank },
        results, citations: allCitations,
        competitors: [...competitors.entries()].map(([domain, count]) => ({ domain, mentions: count })).sort((a,b)=>b.mentions-a.mentions),
      });
    }

    const capturedAt = new Date().toISOString();
    const rawRows = results.map((r) => ({
      project_id: projectId, prompt_id: r.prompt_id, llm_provider: "chatgpt", captured_at: r.completed_at,
      prompt_snapshot: r.prompt, raw_response: r.raw_response ?? { error: r.error_message }, response_text: r.response_text ?? null,
      response_status: r.status, error_message: r.error_message ?? null, run_id: runId,
      project_snapshot: { brand_domains: project.brand_domains ?? [], brand_terms: project.brand_terms ?? [], topics: project.topics ?? [] },
      brand_name_snapshot: String(project.brand_name ?? ""),
    }));
    const { error: rawError } = await admin.from("ai_responses").insert(rawRows);
    if (rawError) {
      await admin.from("tracking_runs").update({ status: "failed", failed_prompts: prompts.length, error_message: "RAW_RESPONSE_WRITE_FAILED", completed_at: new Date().toISOString() }).eq("id", runId);
      return json({ error: "RAW_RESPONSE_WRITE_FAILED" }, 500);
    }

    const dateParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const day = `${dateParts.find((p) => p.type === "year")?.value}-${dateParts.find((p) => p.type === "month")?.value}-${dateParts.find((p) => p.type === "day")?.value}`;
    const topicNames = [...new Set(prompts.map((p) => String(p.topic ?? "General")))];
    const citationsMap = new Map<string, Record<string,unknown>>();
    const competitorMap = new Map<string, number>();
    const competitorTopicMap = new Map<string, number>();
    for (const result of succeeded) {
      for (const c of result.citations as Array<Record<string,unknown>>) {
        const key = String(c.url) + "|" + String(result.topic);
        const old = citationsMap.get(key);
        citationsMap.set(key, { project_id: projectId, metric_date: day, topic: result.topic, llm_provider: "chatgpt", url: c.url, page_name: c.page_name, brand_name: c.brand_name, is_brand_related: c.is_brand_related, frequency: Number(old?.frequency ?? 0) + 1, prompt_id: result.prompt_id });
      }
      for (const host of result.competitor_hosts as string[]) {
        competitorMap.set(host, (competitorMap.get(host) ?? 0) + 1);
        const topicHostKey = JSON.stringify([String(result.topic ?? "General"), host]);
        competitorTopicMap.set(topicHostKey, (competitorTopicMap.get(topicHostKey) ?? 0) + 1);
      }
    }
    const citationRows = [...citationsMap.values()];
    if (citationRows.length) {
      const { error } = await admin.from("citations").upsert(citationRows, { onConflict: "project_id,metric_date,topic,llm_provider,url" });
      if (error) console.error("CITATIONS_WRITE_FAILED", error.message);
    }
    const competitorRows = [
      ...[...competitorMap.entries()].map(([host, count]) => ({
        project_id: projectId, metric_date: day, topic: "Overall", llm_provider: "chatgpt",
        brand_name: host, website: "https://" + host,
        visibility_score: Math.round(count / Math.max(succeeded.length, 1) * 1000) / 10,
        citation_count: count,
      })),
      ...[...competitorTopicMap.entries()].map(([key, count]) => {
        const [topic, host] = JSON.parse(key) as [string, string];
        const topicPromptCount = succeeded.filter((r) => String(r.topic ?? "General") === topic).length;
        return {
          project_id: projectId, metric_date: day, topic, llm_provider: "chatgpt",
          brand_name: host, website: "https://" + host,
          visibility_score: Math.round(count / Math.max(topicPromptCount, 1) * 1000) / 10,
          citation_count: count,
        };
      }),
    ];
    if (competitorRows.length) {
      const { error } = await admin.from("competitors").upsert(competitorRows, { onConflict: "project_id,metric_date,topic,llm_provider,brand_name" });
      if (error) console.error("COMPETITORS_WRITE_FAILED", error.message);
    }

    const allBrands = new Map<string, number>();
    for (const [host, count] of competitorMap) allBrands.set(host, count);
    const brandName = String(project.brand_name ?? "Brand");
    const brandTerms = [brandName, ...(Array.isArray(project.brand_terms) ? project.brand_terms.map(String) : [])].filter(Boolean);
    for (const topic of ["Overall", ...topicNames]) {
      const subset = succeeded.filter((r) => topic === "Overall" || r.topic === topic);
      const mentioned = subset.filter((r) => containsTerm(String(r.response_text ?? ""), brandTerms)).length;
      const score = subset.length ? Math.round(mentioned / subset.length * 1000) / 10 : 0;
      const hosts = new Map<string,number>();
      for (const result of subset) for (const host of result.competitor_hosts as string[]) hosts.set(host, (hosts.get(host) ?? 0) + 1);
      const rank = 1 + [...hosts.values()].filter((count) => count > mentioned).length;
      const row = {
        project_id: projectId, metric_date: day, topic, llm_provider: "Overall",
        visibility_score: score, visibility_rank: rank,
        share_of_voice_score: score, share_of_voice_rank: rank,
        average_position: null, average_position_rank: null,
        citation_count: subset.reduce((sum, r) => sum + (r.citations as unknown[]).length, 0),
      };
      const { error } = await admin.from("visibility_daily").upsert(row, { onConflict: "project_id,metric_date,topic,llm_provider" });
      if (error) console.error("METRICS_WRITE_FAILED", topic, error.message);
      const providerRow = { ...row, llm_provider: "chatgpt" };
      const { error: providerError } = await admin.from("visibility_daily").upsert(providerRow, { onConflict: "project_id,metric_date,topic,llm_provider" });
      if (providerError) console.error("PROVIDER_METRICS_WRITE_FAILED", topic, providerError.message);
    }

    const status = failed.length === 0 ? "completed" : succeeded.length ? "partial" : "failed";
    await admin.from("tracking_runs").update({
      status, completed_prompts: succeeded.length, failed_prompts: failed.length,
      error_message: failed.length ? String(failed.length) + " prompt(s) failed." : null,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return json({
      mode, run_id: runId, status, total_prompts: results.length, completed_prompts: succeeded.length, failed_prompts: failed.length,
      visibility_score: succeeded.length ? Math.round(succeeded.filter((r) => r.brand_mentioned).length / succeeded.length * 1000) / 10 : 0,
      message: "ChatGPT tracking run finished.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TRACKING_RUN_ERROR", message);
    if (activeAdmin && activeRunId) {
      try {
        await activeAdmin.from("tracking_runs").update({
          status: "failed",
          error_message: message.slice(0, 500),
          completed_at: new Date().toISOString(),
        }).eq("id", activeRunId).eq("status", "running");
      } catch (statusError) {
        console.error("TRACKING_RUN_FINALIZE_FAILED", statusError instanceof Error ? statusError.message : String(statusError));
      }
    }
    return json({ error: message || "Unexpected tracking error." }, 500);
  }
});