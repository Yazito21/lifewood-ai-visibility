import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function getConfiguredKey(primary: string, jsonEnv: string, legacy?: string) {
  const direct = Deno.env.get(primary);
  if (direct) return direct;
  if (legacy && Deno.env.get(legacy)) return Deno.env.get(legacy)!;
  const raw = Deno.env.get(jsonEnv);
  if (!raw) return null;
  try { const parsed = JSON.parse(raw); return parsed?.default ? Deno.env.get(parsed.default) ?? null : null; } catch { return null; }
}
function fromB64(value: string) { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
async function decrypt(ciphertext: string, aad: string) {
  const secret = getConfiguredKey("SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("SERVER_SECRET_UNAVAILABLE");
  const [ivText, encryptedText] = ciphertext.split(".");
  if (!ivText || !encryptedText) throw new Error("INVALID_STORED_SECRET");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivText), additionalData: new TextEncoder().encode(aad) }, key, fromB64(encryptedText));
  return new TextDecoder().decode(plain);
}
function normalizedHostLabel(value: string) {
  return value.toLowerCase().replace("https://", "").replace("http://", "").replace(/^www[.]/, "").split("/")[0].split(":")[0].split("?")[0];
}
function hostOfUrl(value: string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return normalizedHostLabel(value); }
}
const nonCompetitorDomains = new Set([
  "google.com", "google.co.uk", "google.ca", "google.com.au", "google.co.in", "googleusercontent.com", "gstatic.com", "googleapis.com",
  "bing.com", "search.yahoo.com", "yahoo.com", "duckduckgo.com", "wikipedia.org", "facebook.com", "instagram.com", "youtube.com",
  "tiktok.com", "x.com", "twitter.com", "linkedin.com", "reddit.com", "goodfirms.co", "clutch.co",
]);
function isGenericCitationDomain(value: string) {
  const host = normalizedHostLabel(value);
  return [...nonCompetitorDomains].some((domain) => host === domain || host.endsWith("." + domain));
}
function titleFromUrl(value: string) {
  const host = hostOfUrl(value);
  return host.split(".").slice(0, -1).join(".").replace(/[-_]+/g, " ").trim() || host;
}
function dateInMalaysia(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  return parts.find((p) => p.type === "year")?.value + "-" + parts.find((p) => p.type === "month")?.value + "-" + parts.find((p) => p.type === "day")?.value;
}
function hasAlias(text: string, aliases: string[]) {
  const source = text.toLocaleLowerCase();
  return aliases.some((alias) => {
    const value = alias.trim().toLocaleLowerCase();
    if (value.length < 3) return false;
    const escaped = value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    return new RegExp("(?<![a-z0-9])" + escaped + "(?![a-z0-9])", "i").test(source);
  });
}
type Candidate = { domain: string; brand_name: string; page_name: string; citations: number };
type Classified = { domain: string; brand_name: string; aliases: string[] };

async function classifyTopic(apiKey: string, project: Record<string, unknown>, topic: string, candidates: Candidate[]): Promise<Classified[]> {
  const unique = [...new Map(candidates.map((item) => [item.domain, item])).values()];
  const output: Classified[] = [];
  for (let offset = 0; offset < unique.length; offset += 80) {
    const chunk = unique.slice(offset, offset + 80);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({
          model: "gpt-4o-mini", temperature: 0, max_output_tokens: 3000,
          input: [
            { role: "system", content: [{ type: "input_text", text:
              "Classify cited domains as direct competitors of the tracked business, for the specified business line/topic. Return ONLY a JSON array of objects shaped {domain, brand_name, aliases}. Include only actual companies/providers offering the same or a closely substitutable service. Exclude publishers, journals, reference and education sites, government or health authorities, directories, review sites, marketplaces, general informational websites, customers, suppliers, search engines and unrelated businesses. For a clinic, include clinics/providers offering comparable clinical services; do not include health publishers. Use only supplied domains and never invent competitors. If uncertain, exclude. Alias strings must be real brand names or names grounded in the supplied candidate; avoid generic terms."
            }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify({
              tracked_brand: project.brand_name, tracked_brand_description: project.brand_description,
              tracked_brand_domains: project.brand_domains, business_line_topic: topic, candidates: chunk,
            }) }] },
          ],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error?.message ?? "OpenAI competitor classification failed").slice(0, 350));
      const text = (Array.isArray(payload?.output) ? payload.output : [])
        .flatMap((item: Record<string, unknown>) => item.type === "message" && Array.isArray(item.content)
          ? item.content.filter((part: Record<string, unknown>) => part.type === "output_text").map((part: Record<string, unknown>) => String(part.text ?? ""))
          : []).join("\n");
      const jsonText = text.match(/\[[\s\S]*\]/)?.[0];
      if (!jsonText) throw new Error("Competitor classifier returned no JSON for topic " + topic);
      let parsed: unknown;
      try { parsed = JSON.parse(jsonText); } catch { throw new Error("Competitor classifier returned invalid JSON for topic " + topic); }
      if (!Array.isArray(parsed)) throw new Error("Competitor classifier returned an invalid result for topic " + topic);
      const allowed = new Map(chunk.map((item) => [item.domain, item]));
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const raw = item as Record<string, unknown>;
        const domain = normalizedHostLabel(String(raw.domain ?? ""));
        const candidate = allowed.get(domain);
        if (!candidate || !domain || isGenericCitationDomain(domain)) continue;
        const brandName = String(raw.brand_name ?? candidate.brand_name ?? "").trim();
        if (!brandName) continue;
        const aliases = [...new Set([brandName, ...(Array.isArray(raw.aliases) ? raw.aliases.map(String) : []), domain, domain.split(".")[0].replace(/[-_]+/g, " ")]
          .map((v) => v.trim()).filter((v) => v.length >= 3))];
        output.push({ domain, brand_name: brandName, aliases });
      }
    } finally { clearTimeout(timeout); }
  }
  return [...new Map(output.map((item) => [item.domain, item])).values()];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publicKey = getConfiguredKey("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? getConfiguredKey("SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS");
    if (!supabaseUrl || !publicKey || !adminKey) return json({ error: "SUPABASE_SERVER_CONFIG_MISSING" }, 500);
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "AUTHORIZATION_TOKEN_MISSING" }, 401);
    const authResponse = await fetch(supabaseUrl + "/auth/v1/user", { headers: { apikey: publicKey, Authorization: "Bearer " + token } });
    if (!authResponse.ok) return json({ error: "AUTH_VALIDATION_FAILED" }, 401);
    const authUser = await authResponse.json();
    const userId = String(authUser?.id ?? "");
    if (!userId) return json({ error: "AUTH_USER_MISSING" }, 401);
    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id ?? "");
    if (!projectId) return json({ error: "PROJECT_ID_REQUIRED" }, 400);

    const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: profile, error: profileError }, { data: member, error: memberError }, { data: project, error: projectError }] = await Promise.all([
      admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
      admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle(),
      admin.from("projects").select("id,brand_name,brand_description,brand_domains,brand_terms,topics,tracking_market,tracking_locations").eq("id", projectId).maybeSingle(),
    ]);
    if (profileError || memberError || projectError) return json({ error: "PROJECT_ACCESS_LOOKUP_FAILED" }, 500);
    if (!project) return json({ error: "PROJECT_NOT_FOUND" }, 404);
    const isAdmin = profile?.role === "superadmin" || profile?.role === "admin" || member?.role === "superadmin" || member?.role === "admin";
    if (!isAdmin) return json({ error: "NOT_AUTHORIZED_TO_BACKFILL_COMPETITORS" }, 403);

    const { data: secret, error: secretError } = await admin.from("llm_secrets").select("ciphertext")
      .eq("project_id", projectId).eq("provider", "chatgpt").maybeSingle();
    if (secretError) return json({ error: "API_KEY_LOOKUP_FAILED" }, 500);
    if (!secret?.ciphertext) return json({ error: "CHATGPT_API_KEY_NOT_CONFIGURED" }, 400);
    const apiKey = await decrypt(secret.ciphertext, projectId + ":chatgpt");

    const { data: existingRows, error: existingError } = await admin.from("direct_competitors")
      .select("id,topic,normalized_domain,brand_name,website,aliases,first_seen_date,last_seen_date").eq("project_id", projectId);
    if (existingError) return json({ error: "DIRECT_COMPETITOR_REGISTRY_READ_FAILED", message: existingError.message }, 500);
    const existingByKey = new Map((existingRows ?? []).map((row: Record<string, unknown>) => [String(row.topic) + "|" + String(row.normalized_domain), row]));

    const citations: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from("citations")
        .select("metric_date,topic,llm_provider,url,page_name,brand_name,is_brand_related,frequency,tracking_location")
        .eq("project_id", projectId).order("metric_date", { ascending: true }).range(offset, offset + 999);
      if (error) return json({ error: "CITATION_HISTORY_READ_FAILED", message: error.message }, 500);
      citations.push(...(data ?? []) as Array<Record<string, unknown>>);
      if ((data ?? []).length < 1000) break;
    }
    const ownedDomains = (Array.isArray(project.brand_domains) ? project.brand_domains : []).map((v) => normalizedHostLabel(String(v))).filter(Boolean);
    const topics = [...new Set([
      ...(Array.isArray(project.topics) ? project.topics.map(String) : []),
      ...citations.map((row) => String(row.topic ?? "General")),
      ...(existingRows ?? []).map((row: Record<string, unknown>) => String(row.topic ?? "")),
    ].filter((topic) => topic && topic.toLowerCase() !== "overall"))];

    const candidatesByTopic = new Map<string, Map<string, Candidate>>();
    const citationDomainCounts = new Map<string, number>();
    const firstSeen = new Map<string, string>();
    const lastSeen = new Map<string, string>();
    for (const row of citations) {
      const topic = String(row.topic ?? "General");
      const domain = hostOfUrl(String(row.url ?? ""));
      const date = String(row.metric_date ?? "");
      if (!domain || !date) continue;
      const dateKey = topic + "|" + domain;
      const oldFirst = firstSeen.get(dateKey), oldLast = lastSeen.get(dateKey);
      if (!oldFirst || date < oldFirst) firstSeen.set(dateKey, date);
      if (!oldLast || date > oldLast) lastSeen.set(dateKey, date);
      const location = String(row.tracking_location ?? "LEGACY");
      const citationKey = [location, date, topic, domain].join("|");
      citationDomainCounts.set(citationKey, (citationDomainCounts.get(citationKey) ?? 0) + Number(row.frequency ?? 1));
      if (row.is_brand_related || isGenericCitationDomain(domain) || ownedDomains.some((owned) => domain === owned || domain.endsWith("." + owned))) continue;
      const topicCandidates = candidatesByTopic.get(topic) ?? new Map<string, Candidate>();
      const old = topicCandidates.get(domain);
      topicCandidates.set(domain, { domain, brand_name: String(row.brand_name || titleFromUrl(String(row.url ?? "")),
        page_name: String(row.page_name ?? ""), citations: (old?.citations ?? 0) + Number(row.frequency ?? 1) });
      candidatesByTopic.set(topic, topicCandidates);
    }

    const allResponses: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from("ai_responses")
        .select("prompt_id,captured_at,response_text,response_status,tracking_location,run_id")
        .eq("project_id", projectId).eq("response_status", "completed").order("captured_at", { ascending: true }).range(offset, offset + 999);
      if (error) return json({ error: "RESPONSE_HISTORY_READ_FAILED", message: error.message }, 500);
      allResponses.push(...(data ?? []) as Array<Record<string, unknown>>);
      if ((data ?? []).length < 1000) break;
    }
    const prompts: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from("prompts").select("id,topic").eq("project_id", projectId).range(offset, offset + 999);
      if (error) return json({ error: "PROMPT_HISTORY_READ_FAILED", message: error.message }, 500);
      prompts.push(...(data ?? []) as Array<Record<string, unknown>>);
      if ((data ?? []).length < 1000) break;
    }
    const promptTopicById = new Map(prompts.map((row) => [String(row.id), String(row.topic ?? "General")]));

    for (const row of existingRows ?? []) {
      const topic = String(row.topic ?? "");
      if (!topic || topic === "Overall") continue;
      const domain = normalizedHostLabel(String(row.normalized_domain ?? ""));
      if (!domain) continue;
      const topicCandidates = candidatesByTopic.get(topic) ?? new Map<string, Candidate>();
      if (!topicCandidates.has(domain)) topicCandidates.set(domain, { domain, brand_name: String(row.brand_name ?? domain), page_name: "", citations: 0 });
      candidatesByTopic.set(topic, topicCandidates);
    }

    const classifiedByTopic = new Map<string, Map<string, Classified>>();
    const classifierRequests: string[] = [];
    for (const topic of topics) {
      const candidateMap = candidatesByTopic.get(topic) ?? new Map<string, Candidate>();
      const alreadyKnown = new Set((existingRows ?? []).filter((row: Record<string, unknown>) => String(row.topic) === topic).map((row: Record<string, unknown>) => String(row.normalized_domain)));
      const toClassify = [...candidateMap.values()].filter((item) => !alreadyKnown.has(item.domain));
      const classified = toClassify.length ? await classifyTopic(apiKey, project as Record<string, unknown>, topic, toClassify) : [];
      if (toClassify.length) classifierRequests.push(topic + ":" + Math.ceil(toClassify.length / 80));
      const merged = new Map<string, Classified>();
      for (const row of existingRows ?? []) {
        if (String(row.topic) !== topic) continue;
        const aliases = Array.isArray(row.aliases) ? row.aliases.map(String) : [];
        merged.set(String(row.normalized_domain), { domain: String(row.normalized_domain), brand_name: String(row.brand_name), aliases: [...new Set([String(row.brand_name), String(row.normalized_domain), ...aliases].filter((v) => v.length >= 3))] });
      }
      for (const item of classified) merged.set(item.domain, item);
      classifiedByTopic.set(topic, merged);
    }

    const registryRows: Array<Record<string, unknown>> = [];
    for (const [topic, map] of classifiedByTopic) for (const item of map.values()) {
      const key = topic + "|" + item.domain;
      const existing = existingByKey.get(key) as Record<string, unknown> | undefined;
      const first = String(existing?.first_seen_date ?? firstSeen.get(key) ?? "");
      const last = String(existing?.last_seen_date ?? lastSeen.get(key) ?? "");
      registryRows.push({
        project_id: projectId, topic, normalized_domain: item.domain, brand_name: item.brand_name, website: "https://" + item.domain,
        aliases: [...new Set([...(Array.isArray(existing?.aliases) ? existing.aliases.map(String) : []), ...item.aliases])],
        first_seen_date: first || dateInMalaysia(new Date().toISOString()), last_seen_date: last || first || dateInMalaysia(new Date().toISOString()),
      });
    }
    const overallMap = new Map<string, Classified>();
    for (const map of classifiedByTopic.values()) for (const item of map.values()) {
      const old = overallMap.get(item.domain);
      overallMap.set(item.domain, old ? { ...old, aliases: [...new Set([...old.aliases, ...item.aliases])] } : item);
    }
    for (const row of existingRows ?? []) if (String(row.topic) === "Overall") {
      const domain = String(row.normalized_domain), old = overallMap.get(domain);
      const existingAliases = Array.isArray(row.aliases) ? row.aliases.map(String) : [];
      overallMap.set(domain, { domain, brand_name: String(row.brand_name), aliases: [...new Set([...(old?.aliases ?? []), String(row.brand_name), domain, ...existingAliases].filter((v) => v.length >= 3))] });
    }
    for (const item of overallMap.values()) {
      const key = "Overall|" + item.domain;
      const existing = existingByKey.get(key) as Record<string, unknown> | undefined;
      const first = String(existing?.first_seen_date ?? [...firstSeen.entries()].filter(([k]) => k.endsWith("|" + item.domain)).map(([, v]) => v).sort()[0] ?? "");
      const last = String(existing?.last_seen_date ?? [...lastSeen.entries()].filter(([k]) => k.endsWith("|" + item.domain)).map(([, v]) => v).sort().at(-1) ?? "");
      registryRows.push({
        project_id: projectId, topic: "Overall", normalized_domain: item.domain, brand_name: item.brand_name, website: "https://" + item.domain,
        aliases: [...new Set([...(Array.isArray(existing?.aliases) ? existing.aliases.map(String) : []), ...item.aliases])],
        first_seen_date: first || dateInMalaysia(new Date().toISOString()), last_seen_date: last || first || dateInMalaysia(new Date().toISOString()),
      });
    }
    for (let offset = 0; offset < registryRows.length; offset += 500) {
      const { error } = await admin.from("direct_competitors").upsert(registryRows.slice(offset, offset + 500), { onConflict: "project_id,topic,normalized_domain" });
      if (error) return json({ error: "DIRECT_COMPETITOR_REGISTRY_WRITE_FAILED", message: error.message }, 500);
    }

    const { data: allRegistryRows, error: registryError } = await admin.from("direct_competitors")
      .select("id,topic,normalized_domain,brand_name,aliases").eq("project_id", projectId);
    if (registryError) return json({ error: "DIRECT_COMPETITOR_REGISTRY_READ_FAILED", message: registryError.message }, 500);

    type Group = { location: string; date: string; topic: string; responses: string[] };
    const groups = new Map<string, Group>();
    function ensureGroup(location: string, date: string, topic: string) {
      const key = [location, date, topic].join("|");
      let group = groups.get(key);
      if (!group) { group = { location, date, topic, responses: [] }; groups.set(key, group); }
      return group;
    }
    for (const response of allResponses) {
      const location = String(response.tracking_location ?? "LEGACY");
      ensureGroup(location, dateInMalaysia(String(response.captured_at)), promptTopicById.get(String(response.prompt_id)) ?? "General")
        .responses.push(String(response.response_text ?? ""));
    }
    for (const row of citations) {
      const date = String(row.metric_date ?? "");
      if (date) ensureGroup(String(row.tracking_location ?? "LEGACY"), date, String(row.topic ?? "General"));
    }
    const registryByTopic = new Map<string, Array<Record<string, unknown>>>();
    for (const row of allRegistryRows ?? []) {
      const topic = String(row.topic), list = registryByTopic.get(topic) ?? [];
      list.push(row as Record<string, unknown>); registryByTopic.set(topic, list);
    }
    const observationRows: Array<Record<string, unknown>> = [];
    for (const group of groups.values()) {
      const entities = registryByTopic.get(group.topic) ?? [];
      for (const entity of entities) {
        const domain = String(entity.normalized_domain);
        const aliases = [...new Set([String(entity.brand_name ?? ""), domain, ...(Array.isArray(entity.aliases) ? entity.aliases.map(String) : [])].filter((v) => v.length >= 3))];
        const presence = group.responses.reduce((count, text) => count + (hasAlias(text, aliases) ? 1 : 0), 0);
        const citationCount = citationDomainCounts.get([group.location, group.date, group.topic, domain].join("|")) ?? 0;
        observationRows.push({
          project_id: projectId, competitor_id: entity.id, metric_date: group.date, tracking_location: group.location,
          llm_provider: "chatgpt", presence_count: presence, response_count: group.responses.length, citation_count: citationCount,
        });
      }
    }
    const overallGroups = new Map<string, Group>();
    for (const group of groups.values()) {
      const key = group.location + "|" + group.date;
      let overall = overallGroups.get(key);
      if (!overall) { overall = { location: group.location, date: group.date, topic: "Overall", responses: [] }; overallGroups.set(key, overall); }
      overall.responses.push(...group.responses);
    }
    for (const [key, group] of overallGroups) {
      const [location, date] = key.split("|");
      for (const entity of registryByTopic.get("Overall") ?? []) {
        const domain = String(entity.normalized_domain);
        const aliases = [...new Set([String(entity.brand_name ?? ""), domain, ...(Array.isArray(entity.aliases) ? entity.aliases.map(String) : [])].filter((v) => v.length >= 3))];
        const presence = group.responses.reduce((count, text) => count + (hasAlias(text, aliases) ? 1 : 0), 0);
        let citationCount = 0;
        for (const [citationKey, count] of citationDomainCounts) {
          const parts = citationKey.split("|");
          if (parts[0] === location && parts[1] === date && parts[3] === domain) citationCount += count;
        }
        observationRows.push({
          project_id: projectId, competitor_id: entity.id, metric_date: date, tracking_location: location,
          llm_provider: "chatgpt", presence_count: presence, response_count: group.responses.length, citation_count: citationCount,
        });
      }
    }
    let observationsWritten = 0;
    for (let offset = 0; offset < observationRows.length; offset += 500) {
      const batch = observationRows.slice(offset, offset + 500);
      const { error } = await admin.from("direct_competitor_observations").upsert(batch, { onConflict: "competitor_id,metric_date,tracking_location,llm_provider" });
      if (error) return json({ error: "DIRECT_COMPETITOR_OBSERVATION_WRITE_FAILED", message: error.message }, 500);
      observationsWritten += batch.length;
    }
    return json({
      status: "completed", project_id: projectId, stored_responses_reused: allResponses.length, stored_citations_reused: citations.length,
      competitor_registry_rows: registryRows.length, historical_observations_upserted: observationsWritten,
      locations_processed: [...new Set([...allResponses.map((row) => String(row.tracking_location ?? "LEGACY")), ...citations.map((row) => String(row.tracking_location ?? "LEGACY"))])],
      classification_batches: classifierRequests, used_new_tracking_run: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("DIRECT_COMPETITOR_BACKFILL_FAILED", message);
    return json({ error: "DIRECT_COMPETITOR_BACKFILL_FAILED", message: message.slice(0, 600) }, 500);
  }
});