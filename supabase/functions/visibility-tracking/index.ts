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

type MatchSummary = { count: number; firstStart: number | null };
const compiledMatcherCache = new Map<string, RegExp>();
const responseMatchCache = new WeakMap<object, Map<string, MatchSummary>>();

function normalizedTerms(terms: string[]) {
  return [...new Set(terms.map((term) => term.trim()).filter((term) => term.length > 1))]
    .sort((a, b) => b.length - a.length);
}

function matcherFor(cleanTerms: string[]) {
  const key = cleanTerms.join("\\u0000");
  let matcher = compiledMatcherCache.get(key);
  if (!matcher) {
    matcher = new RegExp("(?<![A-Za-z0-9])(?:" + cleanTerms.map(escapeRegex).join("|") + ")(?![A-Za-z0-9])", "gi");
    compiledMatcherCache.set(key, matcher);
  }
  return matcher;
}

function summarizeTermMatches(text: string, terms: string[]): MatchSummary {
  const clean = normalizedTerms(terms);
  if (!clean.length) return { count: 0, firstStart: null };
  const matcher = matcherFor(clean);
  let count = 0;
  let firstStart: number | null = null;
  for (const match of text.matchAll(matcher)) {
    const start = match.index ?? 0;
    if (firstStart === null) firstStart = start;
    count += 1;
  }
  return { count, firstStart };
}

// A response is analysed for every topic and for the overall metrics. Cache the
// match summary per response/entity so large runs do not repeatedly rescan the
// same response text for the same aliases.
function cachedTermMatches(result: object, text: string, terms: string[]): MatchSummary {
  const key = normalizedTerms(terms).join("\\u0000");
  let responseCache = responseMatchCache.get(result);
  if (!responseCache) {
    responseCache = new Map<string, MatchSummary>();
    responseMatchCache.set(result, responseCache);
  }
  const cached = responseCache.get(key);
  if (cached) return cached;
  const summary = summarizeTermMatches(text, terms);
  responseCache.set(key, summary);
  return summary;
}

function countTermMentions(text: string, terms: string[]) {
  return summarizeTermMatches(text, terms).count;
}


function normalizedHostLabel(value: string) {
  return value.toLowerCase().replace("https://", "").replace("http://", "").replace(/^www[.]/, "").split("/")[0].split(":")[0];
}

// General search engines, social platforms, and directory/publisher sites are
// useful citation sources, but they are not direct competitors for Lifewood.
const nonCompetitorDomains = new Set([
  "google.com", "google.co.uk", "google.ca", "google.com.au", "google.co.in",
  "googleusercontent.com", "gstatic.com", "googleapis.com",
  "bing.com", "search.yahoo.com", "yahoo.com", "duckduckgo.com",
  "wikipedia.org", "facebook.com", "instagram.com", "youtube.com", "tiktok.com",
  "x.com", "twitter.com", "linkedin.com", "reddit.com", "goodfirms.co", "clutch.co",
]);
function isGenericCitationDomain(value: string) {
  const host = normalizedHostLabel(value);
  return [...nonCompetitorDomains].some((domain) => host === domain || host.endsWith("." + domain));
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
function resolveTrackingCountryCodes(project:Record<string,unknown>):string[]{
 const selected=Array.isArray(project.tracking_locations)?project.tracking_locations.map(String):[String(project.tracking_market??"MY")];
 const value=selected[0] ?? String(project.tracking_market ?? "MY");
 if(value==="GLOBAL")return ["GLOBAL"];
 return /^[A-Z]{2}$/.test(value) ? [value] : [String(project.tracking_market ?? "MY")];
}

type SearchMarket = { type: "approximate"; country: string; timezone?: string };

function searchMarketFor(countryCode: string): SearchMarket | null {
  if (countryCode === "GLOBAL") return null;
  const country = countryCode.toUpperCase();
  const timezoneByCountry: Record<string, string> = {
    MY: "Asia/Kuala_Lumpur", SG: "Asia/Singapore", US: "America/New_York",
    GB: "Europe/London", AU: "Australia/Sydney", CA: "America/Toronto",
    IN: "Asia/Kolkata", ID: "Asia/Jakarta", TH: "Asia/Bangkok",
    PH: "Asia/Manila", VN: "Asia/Ho_Chi_Minh", BN: "Asia/Brunei",
    MM: "Asia/Yangon", KH: "Asia/Phnom_Penh", LA: "Asia/Vientiane",
    TL: "Asia/Dili", CN: "Asia/Shanghai", JP: "Asia/Tokyo",
    KR: "Asia/Seoul", NZ: "Pacific/Auckland", DE: "Europe/Berlin",
    FR: "Europe/Paris", ES: "Europe/Madrid", IT: "Europe/Rome",
    NL: "Europe/Amsterdam", AE: "Asia/Dubai", SA: "Asia/Riyadh",
    ZA: "Africa/Johannesburg", BR: "America/Sao_Paulo", MX: "America/Mexico_City",
    TR: "Europe/Istanbul", PK: "Asia/Karachi", BD: "Asia/Dhaka",
    NG: "Africa/Lagos", EG: "Africa/Cairo", IE: "Europe/Dublin",
    CH: "Europe/Zurich", SE: "Europe/Stockholm", NO: "Europe/Oslo",
    DK: "Europe/Copenhagen", PL: "Europe/Warsaw", PT: "Europe/Lisbon",
    AR: "America/Argentina/Buenos_Aires", CL: "America/Santiago",
  };
  return { type: "approximate", country, ...(timezoneByCountry[country] ? { timezone: timezoneByCountry[country] } : {}) };
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
        tools: [{ type: "web_search", ...(searchMarketFor(String(project.tracking_market ?? "MY")) ? { user_location: searchMarketFor(String(project.tracking_market ?? "MY")) } : {}) }],
        include: ["web_search_call.action.sources"],
        temperature: 0.2,
        input: [
          { role: "system", content: [{ type: "input_text", text: system + (brand ? "\nTracked brand context (use only if relevant): " + brand + (description ? " — " + description : "") + (domains ? ". Official domains: " + domains : "") : "") }] },
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
    const researchSources: Array<{ url: string; title: string; source: string }> = [];
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
        for (const source of item.action.sources) if (typeof source?.url === "string") researchSources.push({ url: source.url, title: String(source.title ?? ""), source: "web_search_source" });
      }
    }
    const uniqueCitations = [...new Map(citations.filter(c => c.url.startsWith("http://") || c.url.startsWith("https://")).map(c => [c.url, c])).values()];
    const uniqueResearchSources = [...new Map(researchSources.filter(c => c.url.startsWith("http://") || c.url.startsWith("https://")).map(c => [c.url, c])).values()];
    return { text: textParts.join("\n\n"), raw: payload, model: payload?.model ?? "gpt-4o-mini", citations: uniqueCitations, researchSources: uniqueResearchSources };
  } finally { clearTimeout(timeout); }
}

type ClassifiedCompetitor = { domain: string; brand_name: string; aliases: string[] };

async function classifyDirectCompetitors(
  apiKey: string,
  project: Record<string, unknown>,
  topic: string,
  candidates: Array<{ domain: string; brand_name: string; page_name: string; citations: number }>,
): Promise<ClassifiedCompetitor[]> {
  if (!candidates.length) return [];
  const unique = [...new Map(candidates.map((item) => [item.domain, item])).values()];
  const chunks: typeof unique[] = [];
  for (let i = 0; i < unique.length; i += 100) chunks.push(unique.slice(i, i + 100));
  const accepted: ClassifiedCompetitor[] = [];
  for (const chunk of chunks) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_output_tokens: 3500,
        input: [
          { role: "system", content: [{ type: "input_text", text:
            "You classify cited websites as direct business competitors. Return ONLY a valid JSON array. Include a website only when it represents a real company/provider offering the same or a closely substitutable service as the tracked brand in the specified business line/topic. Exclude publishers, journals, reference/education sites, government/health authorities, directories, review sites, marketplaces, general informational websites, customers, suppliers, and unrelated businesses. For a clinic, include other clinics/providers offering comparable clinical services, not health publishers such as Healthline or PubMed. For an AI data company, include AI data collection, annotation, AI content, or AEO/GEO service providers relevant to the topic, not AI news sites or general technology publishers. Use only domains supplied in the candidate list; never invent competitors. Output objects shaped as {domain, brand_name, aliases}, where aliases is an array of short names or alternate spellings grounded in the supplied candidate. If uncertain, exclude the candidate."
          }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify({
            tracked_brand: project.brand_name,
            tracked_brand_description: project.brand_description,
            tracked_brand_domains: project.brand_domains,
            business_line_topic: topic,
            candidates: chunk,
          }) }] },
        ],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error?.message ?? "Competitor classification failed").slice(0, 300));
    const output = (Array.isArray(payload?.output) ? payload.output : [])
      .flatMap((item: Record<string, unknown>) => item.type === "message" && Array.isArray(item.content)
        ? item.content.filter((content: Record<string, unknown>) => content.type === "output_text").map((content: Record<string, unknown>) => String(content.text ?? ""))
        : []).join("\n").trim();
    const jsonText = output.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonText) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(jsonText); } catch { continue; }
    if (!Array.isArray(parsed)) continue;
    const allowed = new Map(chunk.map((item) => [item.domain, item]));
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const domain = normalizedHostLabel(String(raw.domain ?? ""));
      const candidate = allowed.get(domain);
      if (!candidate || !domain || isGenericCitationDomain(domain)) continue;
      const name = String(raw.brand_name ?? candidate.brand_name ?? "").trim();
      if (!name) continue;
      const aliases = [...new Set([
        name, domain, domain.split(".")[0].replace(/[-_]+/g, " "),
        ...(Array.isArray(raw.aliases) ? raw.aliases.map(String) : []),
      ].map((value) => value.trim()).filter((value) => value.length > 1))];
      accepted.push({ domain, brand_name: name, aliases });
    }
  }
  return [...new Map(accepted.map((item) => [item.domain, item])).values()];
}

async function processPrompts(prompts: Array<Record<string, unknown>>, providers: string[], project: Record<string, unknown>, apiKeys: Record<string,string>, trackingLocations: string[]) {
  const tasks: Array<{ provider: string; prompt: Record<string,unknown>; trackingLocation: string }> = [];
  for (const provider of providers) {
    if (provider !== "chatgpt") throw new Error("Only ChatGPT is enabled in this first tracking stage. Configure ChatGPT in Settings.");
    if (!apiKeys[provider]) throw new Error("No API key is configured for " + provider + ".");
    for (const prompt of prompts) for (const trackingLocation of trackingLocations) tasks.push({ provider, prompt, trackingLocation });
  }
  const results: Array<Record<string, unknown> | undefined> = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      const { provider, prompt, trackingLocation } = tasks[index];
      const started = new Date().toISOString();
      try {
        const projectForLocation = { ...project, tracking_market: trackingLocation, tracking_location: trackingLocation };
        const answer = await callChatGPT(apiKeys[provider], String(prompt.prompt ?? ""), projectForLocation);
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
        const competitorHosts = [...new Set(citations.filter((c) => !c.is_brand_related).map((c) => hostOf(c.url)).filter((host) => Boolean(host) && !isGenericCitationDomain(host)))];
        results[index] = {
          prompt_id: prompt.id, prompt_number: prompt.prompt_number, prompt: String(prompt.prompt ?? ""), tracking_location: trackingLocation,
          topic: String(prompt.topic ?? "General"), language: String(prompt.language ?? "English"),
          provider, status: "completed", response_text: text, raw_response: answer.raw,
          brand_mentioned: brandMentioned, citations, research_sources: answer.researchSources ?? [], competitor_hosts: competitorHosts,
          model: answer.model, started_at: started, completed_at: new Date().toISOString(), usage: answer.raw?.usage ?? null,
        };
      } catch (error) {
        results[index] = {
          prompt_id: prompt.id, prompt_number: prompt.prompt_number, prompt: String(prompt.prompt ?? ""), tracking_location: trackingLocation,
          topic: String(prompt.topic ?? "General"), language: String(prompt.language ?? "English"),
          provider, status: "failed", error_message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          brand_mentioned: false, citations: [], competitor_hosts: [], started_at: started, completed_at: new Date().toISOString(),
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, tasks.length) }, () => worker()));
  const completed = results.filter((r): r is Record<string,unknown> => Boolean(r));
  // Entity extraction is deliberately separate from citation parsing: many AI answers
  // mention providers without linking to them. Keep the provider payload untouched.
  const succeeded = completed.filter((r) => r.status === "completed" && String(r.response_text ?? "").trim());
  for (let offset = 0; offset < succeeded.length; offset += 10) {
    const batch = succeeded.slice(offset, offset + 10);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKeys.chatgpt },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          max_output_tokens: 6000,
          input: [
            { role: "system", content: [{ type: "input_text", text:
              "Extract explicitly mentioned real-world organizations, brands, clinics, service providers, publishers, directories, and other named entities from each supplied AI response. Do not infer entities that are not stated. Do not treat generic service categories as entities. Preserve the exact name and provide only aliases grounded in the response. Evidence must be a short verbatim excerpt. Return ONLY a JSON array with one object per response_id, shaped as {response_id, entities:[{name,aliases,entity_type,evidence}]}. entity_type must be one of company, clinic, service_provider, publisher, directory, government, other. Include entities whether or not a URL is cited. Never infer an official domain or competitor status."
            }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify(batch.map((r, i) => ({
              response_id: String(r.prompt_id),
              topic: String(r.topic ?? "General"),
              prompt: String(r.prompt ?? ""),
              response: String(r.response_text ?? "").slice(0, 9000),
            }))) }] },
          ],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error?.message ?? "Entity extraction failed").slice(0, 250));
      const output = (Array.isArray(payload?.output) ? payload.output : [])
        .flatMap((item: Record<string, unknown>) => item.type === "message" && Array.isArray(item.content)
          ? item.content.filter((content: Record<string, unknown>) => content.type === "output_text").map((content: Record<string, unknown>) => String(content.text ?? ""))
          : []).join("\n").trim();
      const jsonText = output.match(/\[[\s\S]*\]/)?.[0];
      if (!jsonText) throw new Error("ENTITY_EXTRACTION_INVALID_JSON");
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error("ENTITY_EXTRACTION_INVALID_SHAPE");
      const allowedIds = new Set(batch.map((r) => String(r.prompt_id)));
      const byId = new Map<string, Array<Record<string, unknown>>>();
      for (const item of parsed) {
        if (!item || typeof item !== "object" || !allowedIds.has(String(item.response_id)) || !Array.isArray(item.entities)) continue;
        const entities = item.entities.filter((entity: unknown) => {
          if (!entity || typeof entity !== "object") return false;
          const e = entity as Record<string, unknown>;
          return typeof e.name === "string" && e.name.trim().length > 1 &&
            typeof e.evidence === "string" && e.evidence.trim().length > 0 &&
            String(batch.find((r) => String(r.prompt_id) === String(item.response_id))?.response_text ?? "")
              .toLocaleLowerCase().includes(String(e.evidence).trim().toLocaleLowerCase());
        }).map((entity: Record<string, unknown>) => ({
          name: String(entity.name).trim(),
          aliases: [...new Set((Array.isArray(entity.aliases) ? entity.aliases : []).map(String).map((s: string) => s.trim()).filter((s: string) => s.length > 1))],
          entity_type: ["company","clinic","service_provider","publisher","directory","government","other"].includes(String(entity.entity_type)) ? String(entity.entity_type) : "other",
          evidence: String(entity.evidence).trim(),
        }));
        byId.set(String(item.response_id), entities);
      }
      for (const result of batch) {
        result.response_analysis = {
          status: "completed",
          entities: byId.get(String(result.prompt_id)) ?? [],
          research_sources: Array.isArray(result.research_sources) ? result.research_sources : [],
          extraction_model: payload?.model ?? "gpt-4o-mini",
          extracted_at: new Date().toISOString(),
        };
      }
    } catch (error) {
      // Preserve raw results and make extraction failure explicit; never silently
      // represent a failed entity extraction as a successful empty result.
      for (const result of batch) result.response_analysis = {
        status: "failed",
        entities: [],
        research_sources: Array.isArray(result.research_sources) ? result.research_sources : [],
        error: (error instanceof Error ? error.message : String(error)).slice(0, 250),
      };
    }
  }
  for (const result of completed) {
    if (!result.response_analysis) result.response_analysis = { status: "not_run", entities: [] };
  }
  return completed;
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
      admin.from("projects").select("id,brand_name,brand_description,brand_domains,brand_terms,topics,tracking_market,tracking_locations").eq("id", projectId).maybeSingle(),
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
    const isSuperadmin = profile?.role === "superadmin";
    const isAdmin = isSuperadmin || profile?.role === "admin" || member?.role === "superadmin" || member?.role === "admin";
    const canAccessProject = isSuperadmin || Boolean(member);
    if (mode === "sample" && !canAccessProject) return json({ error: "NOT_AUTHORIZED_FOR_PROJECT" }, 403);
    if (mode !== "sample" && !isAdmin) return json({ error: "NOT_AUTHORIZED_TO_RUN_TRACKING" }, 403);

    const providerIds: string[] = Array.isArray(body?.providers) ? [...new Set((body.providers as unknown[]).map((provider) => String(provider)))] : ["chatgpt"];
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
    const trackingLocationsForRun = resolveTrackingCountryCodes(project as Record<string, unknown>);
    if (!trackingLocationsForRun.length) return json({ error: "NO_VALID_TRACKING_LOCATIONS" }, 400);
    let runId: string | null = null;
    let isSuperadminRerun = false;
    if (mode !== "sample") {
      runId = crypto.randomUUID();
      if (isSuperadmin) {
        // Superadmins may rerun tracking on the same Malaysia-time day.
        // The daily claim is advanced to the newest run, while previous run history is retained.
        isSuperadminRerun = true;
        const todayMYT = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date());
        const { data: existingClaim, error: existingClaimError } = await admin
          .from("tracking_run_daily_claims")
          .select("run_id")
          .eq("project_id", projectId)
          .eq("run_date", todayMYT)
          .maybeSingle();
        if (existingClaimError) {
          console.error("DAILY_TRACKING_CLAIM_LOOKUP_FAILED", existingClaimError.message);
          return json({ error: "DAILY_TRACKING_CLAIM_LOOKUP_FAILED" }, 500);
        }
        const { error: runInsertError } = await admin.from("tracking_runs").insert({
          id: runId, project_id: projectId, started_by: userId, provider: "chatgpt", status: "running", tracking_location: trackingLocationsForRun[0],
          total_prompts: prompts.length * trackingLocationsForRun.length, completed_prompts: 0, failed_prompts: 0,
        });
        if (runInsertError) return json({ error: "TRACKING_RUN_CREATE_FAILED", message: runInsertError.message }, 500);
        const now = new Date().toISOString();
        if (existingClaim?.run_id) {
          const { error: claimUpdateError } = await admin.from("tracking_run_daily_claims")
            .update({ run_id: runId, started_by: userId, created_at: now })
            .eq("project_id", projectId).eq("run_date", todayMYT);
          if (claimUpdateError) {
            await admin.from("tracking_runs").delete().eq("id", runId);
            return json({ error: "DAILY_TRACKING_CLAIM_UPDATE_FAILED", message: claimUpdateError.message }, 500);
          }
          await admin.from("tracking_runs").update({ error_message: "Superseded by a Superadmin rerun." })
            .eq("id", existingClaim.run_id).neq("status", "running");
        } else {
          const { error: claimInsertError } = await admin.from("tracking_run_daily_claims").insert({
            project_id: projectId, run_date: todayMYT, run_id: runId, started_by: userId, created_at: now,
          });
          if (claimInsertError) {
            await admin.from("tracking_runs").delete().eq("id", runId);
            return json({ error: "DAILY_TRACKING_CLAIM_CREATE_FAILED", message: claimInsertError.message }, 500);
          }
        }
      } else {
        const { data: claimRows, error: claimError } = await admin.rpc("claim_daily_tracking_run", {
          p_project_id: projectId,
          p_started_by: userId,
          p_run_id: runId,
          p_total_prompts: prompts.length * trackingLocationsForRun.length,
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
      }
      activeRunId = runId;
    }
    const results = await processPrompts(prompts as Array<Record<string,unknown>>, providerIds, project as Record<string,unknown>, { chatgpt: apiKey }, trackingLocationsForRun);
    const succeeded = results.filter((r) => r.status === "completed");
    const failed = results.filter((r) => r.status === "failed");

    // Sample mode returns data only to this request. It does not create runs or write result data.
    if (mode === "sample") {
      const total = results.length || 1;
      const brandCount = succeeded.filter((r) => r.brand_mentioned).length;
      const competitors = new Map<string, number>();
      for (const result of succeeded) for (const host of result.competitor_hosts as string[]) competitors.set(host, (competitors.get(host) ?? 0) + 1);
      const brandRank = competitors.size ? 1 + [...competitors.values()].filter((count) => count > brandCount).length : null;
      const allCitations = succeeded.flatMap((r) => (r.citations as Array<Record<string,unknown>>).map((c) => ({ ...c, topic: r.topic, prompt: r.prompt, prompt_number: r.prompt_number, provider: r.provider })));
      return json({
        mode, project: { brand_name: project.brand_name }, providers: providerIds,
        summary: { total_prompts: results.length, completed: succeeded.length, failed: failed.length, visibility_score: Math.round(brandCount / total * 1000) / 10, visibility_rank: brandRank },
        results, citations: allCitations,
        competitors: [...competitors.entries()].map(([domain, count]) => ({ domain, mentions: count })).sort((a,b)=>b.mentions-a.mentions),
      });
    }

    const capturedAt = new Date().toISOString();
    // On a Superadmin rerun, remove this project's current-day data before writing
    // the replacement result set, so partial failures or stale citations do not linger.
    if (isSuperadminRerun) {
      // Discard earlier prompt responses and derived rows for the same Malaysia-time day.
      const datePartsForCleanup = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date());
      const rerunDay = `${datePartsForCleanup.find((p) => p.type === "year")?.value}-${datePartsForCleanup.find((p) => p.type === "month")?.value}-${datePartsForCleanup.find((p) => p.type === "day")?.value}`;
      const dayStart = new Date(rerunDay + "T00:00:00+08:00").toISOString();
      const dayEnd = new Date(new Date(rerunDay + "T00:00:00+08:00").getTime() + 86400000).toISOString();
      const { error: responseDeleteError } = await admin.from("ai_responses")
        .delete().eq("project_id", projectId).eq("tracking_location", trackingLocationsForRun[0]).gte("captured_at", dayStart).lt("captured_at", dayEnd);
      if (responseDeleteError) return json({ error: "SUPERADMIN_RERUN_CLEANUP_FAILED", message: responseDeleteError.message }, 500);
      const { error: citationsDeleteError } = await admin.from("citations").delete().eq("project_id", projectId).eq("metric_date", rerunDay).eq("tracking_location", trackingLocationsForRun[0]);
      if (citationsDeleteError) return json({ error: "SUPERADMIN_RERUN_CLEANUP_FAILED", message: citationsDeleteError.message }, 500);
      const { error: competitorsDeleteError } = await admin.from("competitors").delete().eq("project_id", projectId).eq("metric_date", rerunDay).eq("tracking_location", trackingLocationsForRun[0]);
      if (competitorsDeleteError) return json({ error: "SUPERADMIN_RERUN_CLEANUP_FAILED", message: competitorsDeleteError.message }, 500);
      // Remove only the replaceable daily observations; keep the append-only competitor registry intact.
      const { error: directObservationDeleteError } = await admin.from("direct_competitor_observations").delete().eq("project_id", projectId).eq("metric_date", rerunDay).eq("tracking_location", trackingLocationsForRun[0]);
      if (directObservationDeleteError) return json({ error: "SUPERADMIN_RERUN_CLEANUP_FAILED", message: directObservationDeleteError.message }, 500);
      const { error: metricsDeleteError } = await admin.from("visibility_daily").delete().eq("project_id", projectId).eq("metric_date", rerunDay).eq("tracking_location", trackingLocationsForRun[0]);
      if (metricsDeleteError) return json({ error: "SUPERADMIN_RERUN_CLEANUP_FAILED", message: metricsDeleteError.message }, 500);
    }
    const rawRows = results.map((r) => ({
      project_id: projectId, prompt_id: r.prompt_id, llm_provider: "chatgpt", captured_at: r.completed_at, tracking_location: r.tracking_location ?? null,
      prompt_snapshot: r.prompt, raw_response: r.raw_response ?? { error: r.error_message }, response_text: r.response_text ?? null,
      response_status: r.status, error_message: r.error_message ?? null, run_id: runId,
      project_snapshot: { brand_domains: project.brand_domains ?? [], brand_terms: project.brand_terms ?? [], topics: project.topics ?? [], tracking_locations: project.tracking_locations ?? [project.tracking_market ?? "MY"], tracking_location: r.tracking_location ?? null },
      response_analysis: r.response_analysis ?? { status: "not_run", entities: [] },
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
    if (isSuperadminRerun) {
      // Remove today's old summary rows so metrics for disappeared topics are not retained.
      const { error: metricsCleanupError } = await admin.from("visibility_daily")
        .delete().eq("project_id", projectId).eq("metric_date", day).eq("tracking_location", trackingLocationsForRun[0]);
      if (metricsCleanupError) return json({ error: "SUPERADMIN_RERUN_CLEANUP_FAILED", message: metricsCleanupError.message }, 500);
    }
    const topicNames = [...new Set(prompts.map((p) => String(p.topic ?? "General")))];
    const citationsMap = new Map<string, Record<string,unknown>>();
    const competitorMap = new Map<string, number>();
    const competitorTopicMap = new Map<string, number>();
    for (const result of succeeded) {
      for (const c of result.citations as Array<Record<string,unknown>>) {
        const key = String(c.url) + "|" + String(result.topic);
        const old = citationsMap.get(key);
        citationsMap.set(key, { project_id: projectId, metric_date: day, tracking_location: trackingLocationsForRun[0], topic: result.topic, llm_provider: "chatgpt", url: c.url, page_name: c.page_name, brand_name: c.brand_name, is_brand_related: c.is_brand_related, frequency: Number(old?.frequency ?? 0) + 1, prompt_id: result.prompt_id });
      }
      for (const host of result.competitor_hosts as string[]) {
        competitorMap.set(host, (competitorMap.get(host) ?? 0) + 1);
        const topicHostKey = JSON.stringify([String(result.topic ?? "General"), host]);
        competitorTopicMap.set(topicHostKey, (competitorTopicMap.get(topicHostKey) ?? 0) + 1);
      }
    }
    const citationRows = [...citationsMap.values()];
    if (citationRows.length) {
      const { error } = await admin.from("citations").upsert(citationRows, { onConflict: "project_id,metric_date,topic,llm_provider,url,tracking_location" });
      if (error) throw new Error("CITATIONS_WRITE_FAILED: " + error.message);
    }

    // Bootstrap the append-only registry from existing citation history exactly once.
    // This lets historical reporting periods continue to work after the new model is deployed.
    const { data: registryProbe, error: registryProbeError } = await admin
      .from("direct_competitors").select("topic").eq("project_id", projectId);
    if (registryProbeError) throw new Error("DIRECT_COMPETITOR_REGISTRY_READ_FAILED: " + registryProbeError.message);
    const existingRegistryTopics = new Set((registryProbe ?? []).map((row: Record<string, unknown>) => String(row.topic)));
    const bootstrapTopics = new Set(["Overall", ...topicNames].filter((topic) => !existingRegistryTopics.has(topic)));
    const needsCompetitorBootstrap = bootstrapTopics.size > 0;
    const historicalFirstSeen = new Map<string, string>();
    const historicalLastSeen = new Map<string, string>();
    const historicalCitationCounts = new Map<string, number>();

    // Classify citation candidates against the tracked brand's business line.
    // The registry is append-only: new domains are added, aliases are enriched,
    // and existing competitors are never removed when a later run omits them.
    const classifierCandidatesByTopic = new Map<string, Map<string, { domain: string; brand_name: string; page_name: string; citations: number }>>();
    const ownedDomains = (Array.isArray(project.brand_domains) ? project.brand_domains : [])
      .map((value) => normalizedHostLabel(String(value))).filter(Boolean);
    for (const result of succeeded) {
      const resultTopic = String(result.topic ?? "General");
      const topicCandidates = classifierCandidatesByTopic.get(resultTopic) ?? new Map();
      for (const citation of result.citations as Array<Record<string, unknown>>) {
        if (citation.is_brand_related) continue;
        const domain = normalizedHostLabel(String(citation.domain ?? citation.url ?? ""));
        if (!domain || isGenericCitationDomain(domain) ||
          ownedDomains.some((owned) => domain === owned || domain.endsWith("." + owned))) continue;
        const previous = topicCandidates.get(domain);
        topicCandidates.set(domain, {
          domain,
          brand_name: String(citation.brand_name ?? titleFromUrl(String(citation.url ?? ""))),
          page_name: String(citation.page_name ?? ""),
          citations: (previous?.citations ?? 0) + 1,
        });
      }
      // Search-result sources are not citations, but can help identify the domain
      // of an entity that the answer explicitly mentions. Only use a source when
      // its title/domain clearly matches an extracted entity name or alias.
      const extractedEntities = Array.isArray((result.response_analysis as Record<string, unknown> | undefined)?.entities)
        ? (result.response_analysis as Record<string, unknown>).entities as Array<Record<string, unknown>>
        : [];
      const researchSources = Array.isArray(result.research_sources)
        ? result.research_sources as Array<Record<string, unknown>>
        : [];
      for (const entity of extractedEntities) {
        const names = [String(entity.name ?? ""), ...(Array.isArray(entity.aliases) ? entity.aliases.map(String) : [])]
          .map((name) => name.trim().toLocaleLowerCase()).filter((name) => name.length > 2);
        if (!names.length) continue;
        for (const source of researchSources) {
          const url = String(source.url ?? "");
          const domain = normalizedHostLabel(String(url));
          const sourceLabel = (String(source.title ?? "") + " " + domain.replace(/[._-]+/g, " ")).toLocaleLowerCase();
          if (!domain || isGenericCitationDomain(domain) ||
            ownedDomains.some((owned) => domain === owned || domain.endsWith("." + owned)) ||
            !names.some((name) => sourceLabel.includes(name) || name.includes(domain.split(".")[0].replace(/[-_]+/g, " ")))) continue;
          const previous = topicCandidates.get(domain);
          topicCandidates.set(domain, {
            domain,
            brand_name: String(entity.name),
            page_name: String(source.title ?? titleFromUrl(url)),
            citations: (previous?.citations ?? 0) + 1,
          });
        }
      }
      classifierCandidatesByTopic.set(resultTopic, topicCandidates);
    }

    if (needsCompetitorBootstrap) {
      for (let offset = 0; ; offset += 1000) {
        const { data: historicalCitations, error: historyError } = await admin
          .from("citations")
          .select("topic,url,brand_name,page_name,is_brand_related,frequency,metric_date,tracking_location")
          .eq("project_id", projectId)
          .eq("tracking_location", trackingLocationsForRun[0])
          .order("metric_date", { ascending: true })
          .range(offset, offset + 999);
        if (historyError) throw new Error("DIRECT_COMPETITOR_HISTORY_READ_FAILED: " + historyError.message);
        const rows = historicalCitations ?? [];
        for (const citation of rows as Array<Record<string, unknown>>) {
          const topic = String(citation.topic ?? "General");
          const domain = normalizedHostLabel(String(citation.url ?? ""));
          const date = String(citation.metric_date ?? "");
          if (!domain || !date) continue;
          for (const entityTopic of new Set([topic, "Overall"])) {
            const dateKey = entityTopic + "|" + domain;
            const first = historicalFirstSeen.get(dateKey);
            const last = historicalLastSeen.get(dateKey);
            if (!first || date < first) historicalFirstSeen.set(dateKey, date);
            if (!last || date > last) historicalLastSeen.set(dateKey, date);
          }
          if (!citation.is_brand_related && !isGenericCitationDomain(domain) &&
            (bootstrapTopics.has(topic) || bootstrapTopics.has("Overall")) &&
            !ownedDomains.some((owned) => domain === owned || domain.endsWith("." + owned))) {
            const topicCandidates = classifierCandidatesByTopic.get(topic) ?? new Map();
            const previous = topicCandidates.get(domain);
            topicCandidates.set(domain, {
              domain,
              brand_name: String(citation.brand_name ?? titleFromUrl(String(citation.url ?? ""))),
              page_name: String(citation.page_name ?? ""),
              citations: (previous?.citations ?? 0) + Number(citation.frequency ?? 1),
            });
            classifierCandidatesByTopic.set(topic, topicCandidates);
          }
          if (!citation.is_brand_related && !isGenericCitationDomain(domain)) {
            const citationKey = [date, topic, domain].join("|");
            historicalCitationCounts.set(citationKey, (historicalCitationCounts.get(citationKey) ?? 0) + Number(citation.frequency ?? 1));
          }
        }
        if (rows.length < 1000) break;
      }
    }

    const discoveredByTopic = new Map<string, Map<string, ClassifiedCompetitor>>();
    for (const topic of topicNames) {
      const candidates = [...(classifierCandidatesByTopic.get(topic)?.values() ?? [])];
      try {
        const classified = await classifyDirectCompetitors(apiKeys.chatgpt, project, topic, candidates);
        discoveredByTopic.set(topic, new Map(classified.map((item) => [item.domain, item])));
      } catch (classificationError) {
        console.error("DIRECT_COMPETITOR_CLASSIFICATION_FAILED", topic,
          classificationError instanceof Error ? classificationError.message : String(classificationError));
        discoveredByTopic.set(topic, new Map());
      }
    }

    const discoveredEntities = new Map<string, { topic: string; domain: string; brand_name: string; website: string; aliases: string[] }>();
    for (const [topic, competitorsForTopic] of discoveredByTopic) {
      for (const item of competitorsForTopic.values()) {
        const topicsToSave = [topic, "Overall"];
        for (const entityTopic of topicsToSave) {
          const key = entityTopic + "|" + item.domain;
          const previous = discoveredEntities.get(key);
          discoveredEntities.set(key, {
            topic: entityTopic, domain: item.domain,
            brand_name: previous?.brand_name ?? item.brand_name,
            website: "https://" + item.domain,
            aliases: [...new Set([...(previous?.aliases ?? []), ...item.aliases])],
          });
        }
      }
    }

    const { data: existingCompetitors, error: existingCompetitorsError } = await admin
      .from("direct_competitors")
      .select("id,topic,normalized_domain,brand_name,website,aliases,first_seen_date,last_seen_date")
      .eq("project_id", projectId);
    if (existingCompetitorsError) throw new Error("DIRECT_COMPETITOR_REGISTRY_READ_FAILED: " + existingCompetitorsError.message);
    const existingByKey = new Map((existingCompetitors ?? []).map((item: Record<string, unknown>) =>
      [String(item.topic) + "|" + String(item.normalized_domain), item]));
    const registryUpserts = [...discoveredEntities.values()].map((item) => {
      const existing = existingByKey.get(item.topic + "|" + item.domain) as Record<string, unknown> | undefined;
      return {
        project_id: projectId, topic: item.topic, normalized_domain: item.domain,
        brand_name: item.brand_name, website: item.website,
        aliases: [...new Set([
          ...(Array.isArray(existing?.aliases) ? existing.aliases.map(String) : []),
          ...item.aliases,
        ])],
        first_seen_date: String(existing?.first_seen_date ?? historicalFirstSeen.get(item.topic + "|" + item.domain) ?? day),
        last_seen_date: (() => {
          const discoveredLast = historicalLastSeen.get(item.topic + "|" + item.domain) ?? day;
          const existingLast = String(existing?.last_seen_date ?? "");
          return [discoveredLast, existingLast].filter(Boolean).sort().at(-1) ?? day;
        })(),
      };
    });
    if (registryUpserts.length) {
      const { error } = await admin.from("direct_competitors").upsert(registryUpserts, {
        onConflict: "project_id,topic,normalized_domain",
      });
      if (error) throw new Error("DIRECT_COMPETITOR_REGISTRY_WRITE_FAILED: " + error.message);
    }
    const { data: registryRows, error: registryReadError } = await admin
      .from("direct_competitors")
      .select("id,topic,normalized_domain,brand_name,website,aliases")
      .eq("project_id", projectId)
      .in("topic", ["Overall", ...topicNames]);
    if (registryReadError) throw new Error("DIRECT_COMPETITOR_REGISTRY_READ_FAILED: " + registryReadError.message);

    const entitiesByTopic = new Map<string, Array<{ id: string; key: string; domain: string; brand_name: string; website: string; aliases: string[] }>>();
    for (const topic of ["Overall", ...topicNames]) {
      const rows = (registryRows ?? []).filter((row: Record<string, unknown>) => String(row.topic) === topic);
      entitiesByTopic.set(topic, rows.map((row: Record<string, unknown>) => ({
        id: String(row.id), key: String(row.normalized_domain), domain: String(row.normalized_domain),
        brand_name: String(row.brand_name), website: String(row.website ?? ""),
        aliases: [...new Set([
          String(row.brand_name ?? ""), String(row.normalized_domain ?? ""),
          String(row.normalized_domain ?? "").split(".")[0].replace(/[-_]+/g, " "),
          ...(Array.isArray(row.aliases) ? row.aliases.map(String) : []),
        ].map((value) => value.trim()).filter((value) => value.length > 1))],
      })));
    }

    if (needsCompetitorBootstrap) {
      const { data: promptRows, error: promptRowsError } = await admin
        .from("prompts").select("id,topic").eq("project_id", projectId);
      if (promptRowsError) throw new Error("DIRECT_COMPETITOR_HISTORY_READ_FAILED: " + promptRowsError.message);
      const promptTopicById = new Map((promptRows ?? []).map((row: Record<string, unknown>) => [String(row.id), String(row.topic ?? "General")]));
      const historicalGroups = new Map<string, Array<{ topic: string; text: string }>>();
      for (let offset = 0; ; offset += 1000) {
        const { data: historicalResponses, error: responseHistoryError } = await admin
          .from("ai_responses")
          .select("prompt_id,captured_at,response_text,tracking_location")
          .eq("project_id", projectId).eq("tracking_location", trackingLocationsForRun[0])
          .eq("response_status", "completed").order("captured_at", { ascending: true })
          .range(offset, offset + 999);
        if (responseHistoryError) throw new Error("DIRECT_COMPETITOR_HISTORY_READ_FAILED: " + responseHistoryError.message);
        const rows = historicalResponses ?? [];
        for (const response of rows as Array<Record<string, unknown>>) {
          const topic = promptTopicById.get(String(response.prompt_id)) ?? "General";
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
          }).formatToParts(new Date(String(response.captured_at)));
          const date = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
          const key = date + "|" + topic;
          const group = historicalGroups.get(key) ?? [];
          group.push({ topic, text: String(response.response_text ?? "") });
          historicalGroups.set(key, group);
        }
        if (rows.length < 1000) break;
      }

      const historicalObservationRows: Array<Record<string, unknown>> = [];
      const historicalDates = [...new Set([...historicalGroups.keys()].map((key) => key.split("|")[0]))].sort();
      for (const [groupKey, group] of historicalGroups) {
        const [date, topic] = groupKey.split("|");
        for (const entity of entitiesByTopic.get(topic) ?? []) {
          const presenceCount = group.filter((response) => cachedTermMatches(
            response, response.text, entity.aliases
          ).count > 0).length;
          const citationCount = historicalCitationCounts.get([date, topic, entity.domain].join("|")) ?? 0;
          historicalObservationRows.push({
            project_id: projectId, competitor_id: entity.id, metric_date: date,
            tracking_location: trackingLocationsForRun[0], llm_provider: "chatgpt",
            presence_count: presenceCount, response_count: group.length, citation_count: citationCount,
          });
        }
      }
      // Overall is the union of the brand's business lines; count each competitor once per date.
      for (const date of historicalDates) {
        const subset = [...historicalGroups.entries()]
          .filter(([key]) => key.startsWith(date + "|"))
          .flatMap(([, values]) => values);
        for (const entity of entitiesByTopic.get("Overall") ?? []) {
          const presenceCount = subset.filter((response) => cachedTermMatches(
            response, response.text, entity.aliases
          ).count > 0).length;
          const citationCount = [...historicalCitationCounts.entries()].filter(([key]) => {
            const [citationDate, , domain] = key.split("|");
            return citationDate === date && domain === entity.domain;
          }).reduce((sum, [, count]) => sum + count, 0);
          historicalObservationRows.push({
            project_id: projectId, competitor_id: entity.id, metric_date: date,
            tracking_location: trackingLocationsForRun[0], llm_provider: "chatgpt",
            presence_count: presenceCount, response_count: subset.length, citation_count: citationCount,
          });
        }
      }
      for (let offset = 0; offset < historicalObservationRows.length; offset += 500) {
        const batch = historicalObservationRows.slice(offset, offset + 500);
        const { error: backfillError } = await admin.from("direct_competitor_observations").upsert(batch, {
          onConflict: "competitor_id,metric_date,tracking_location,llm_provider",
        });
        if (backfillError) throw new Error("DIRECT_COMPETITOR_HISTORY_BACKFILL_FAILED: " + backfillError.message);
      }
    }

    const competitorRows = ["Overall", ...topicNames].flatMap((topic) => {
      const subset = succeeded.filter((result) => topic === "Overall" || String(result.topic ?? "General") === topic);
      return (entitiesByTopic.get(topic) ?? []).map((entity) => {
        const mentions = subset.filter((result) => cachedTermMatches(
          result, String(result.response_text ?? ""), entity.aliases
        ).count > 0).length;
        const citationCount = subset.reduce((sum, result) => sum + (result.citations as Array<Record<string, unknown>>)
          .filter((citation) => normalizedHostLabel(String(citation.domain ?? citation.url ?? "")) === entity.domain).length, 0);
        return {
          project_id: projectId, metric_date: day, tracking_location: trackingLocationsForRun[0],
          topic, llm_provider: "chatgpt", brand_name: entity.brand_name, website: entity.website,
          visibility_score: Math.round(mentions / Math.max(subset.length, 1) * 1000) / 10,
          citation_count: citationCount,
        };
      });
    });
    if (competitorRows.length) {
      const { error } = await admin.from("competitors").upsert(competitorRows, {
        onConflict: "project_id,metric_date,topic,llm_provider,brand_name,tracking_location",
      });
      if (error) throw new Error("COMPETITORS_WRITE_FAILED: " + error.message);
    }

    const brandName = String(project.brand_name ?? "Brand");
    const brandTerms = [brandName, ...(Array.isArray(project.brand_terms) ? project.brand_terms.map(String) : [])].filter(Boolean);
    const brandKey = "__tracked_brand__";

    function analyzeSubset(subset: Array<Record<string, unknown>>, topic: string) {
      const entities = [{ key: brandKey, aliases: brandTerms }, ...(entitiesByTopic.get(topic) ?? [])];
      const brandResponseCount = subset.filter((result) =>
        cachedTermMatches(result, String(result.response_text ?? ""), brandTerms).count > 0
      ).length;
      const visibilityScore = subset.length ? Math.round(brandResponseCount / subset.length * 1000) / 10 : 0;

      const mentionCounts = new Map<string, number>(entities.map((entity) => [entity.key, 0]));
      const presenceCounts = new Map<string, number>(entities.map((entity) => [entity.key, 0]));
      const positionTotals = new Map<string, number>(entities.map((entity) => [entity.key, 0]));
      const positionSamples = new Map<string, number>(entities.map((entity) => [entity.key, 0]));
      let totalBrandMentions = 0;
      let targetPositionTotal = 0;
      let targetPositionSamples = 0;

      for (const result of subset) {
        const text = String(result.response_text ?? "");
        const firstPositions = new Map<string, number>();
        for (const entity of entities) {
          const matches = cachedTermMatches(result, text, entity.aliases);
          mentionCounts.set(entity.key, (mentionCounts.get(entity.key) ?? 0) + matches.count);
          if (matches.count > 0) {
            presenceCounts.set(entity.key, (presenceCounts.get(entity.key) ?? 0) + 1);
            firstPositions.set(entity.key, matches.firstStart ?? 0);
          }
        }
        totalBrandMentions += entities.reduce((sum, entity) => sum + cachedTermMatches(result, text, entity.aliases).count, 0);
        if (firstPositions.has(brandKey)) {
          const ordered = [...firstPositions.entries()].sort((a, b) => a[1] - b[1]);
          const targetPosition = ordered.findIndex(([key]) => key === brandKey) + 1;
          if (targetPosition > 0) {
            targetPositionTotal += targetPosition;
            targetPositionSamples += 1;
          }
        }
        for (const [key, firstPosition] of firstPositions) {
          const ordered = [...firstPositions.entries()].sort((a, b) => a[1] - b[1]);
          const rank = ordered.findIndex(([candidate]) => candidate === key) + 1;
          if (rank > 0) {
            positionTotals.set(key, (positionTotals.get(key) ?? 0) + rank);
            positionSamples.set(key, (positionSamples.get(key) ?? 0) + 1);
          }
        }
      }

      const brandMentions = mentionCounts.get(brandKey) ?? 0;
      const shareOfVoice = totalBrandMentions > 0 ? Math.round(brandMentions / totalBrandMentions * 1000) / 10 : 0;
      const averagePosition = targetPositionSamples > 0
        ? Math.round(targetPositionTotal / targetPositionSamples * 100) / 100
        : null;
      const visibilityRank = entities.length <= 1 ? null : 1 + [...presenceCounts.entries()]
        .filter(([key, count]) => key !== brandKey && count > brandResponseCount).length;
      const shareOfVoiceRank = 1 + [...mentionCounts.entries()]
        .filter(([key, count]) => key !== brandKey && count > brandMentions).length;
      const competitorAveragePositions = [...positionTotals.entries()]
        .filter(([key]) => key !== brandKey)
        .map(([key, total]) => ({ key, average: (positionSamples.get(key) ?? 0) ? total / (positionSamples.get(key) ?? 1) : null }))
        .filter((item) => item.average !== null) as Array<{ key: string; average: number }>;
      const averagePositionRank = averagePosition === null
        ? null
        : 1 + competitorAveragePositions.filter((item) => item.average! < averagePosition).length;

      return {
        metrics: {
          visibility_score: visibilityScore,
          visibility_rank: visibilityRank,
          share_of_voice_score: shareOfVoice,
          share_of_voice_rank: shareOfVoiceRank,
          average_position: averagePosition,
          average_position_rank: averagePositionRank,
        },
        competitorPresence: Object.fromEntries([...presenceCounts.entries()].filter(([key]) => key !== brandKey)),
      };
    }

    for (const topic of ["Overall", ...topicNames]) {
      const subset = succeeded.filter((r) => topic === "Overall" || r.topic === topic);
      const { metrics, competitorPresence } = analyzeSubset(subset, topic);
      const observations = (entitiesByTopic.get(topic) ?? []).map((entity) => ({
        project_id: projectId, competitor_id: entity.id, metric_date: day,
        tracking_location: trackingLocationsForRun[0], llm_provider: "chatgpt",
        presence_count: Number(competitorPresence[entity.key] ?? 0),
        response_count: subset.length,
        citation_count: subset.reduce((sum, result) => sum + (result.citations as Array<Record<string, unknown>>)
          .filter((citation) => normalizedHostLabel(String(citation.domain ?? citation.url ?? "")) === entity.domain).length, 0),
      }));
      if (observations.length) {
        const { error: observationError } = await admin.from("direct_competitor_observations").upsert(observations, {
          onConflict: "competitor_id,metric_date,tracking_location,llm_provider",
        });
        if (observationError) throw new Error("DIRECT_COMPETITOR_OBSERVATION_WRITE_FAILED: " + observationError.message);
      }
      const row = {
        project_id: projectId, metric_date: day, tracking_location: trackingLocationsForRun[0], topic, llm_provider: "Overall",
        ...metrics,
        citation_count: subset.reduce((sum, r) => sum + (r.citations as unknown[]).length, 0),
      };
      const { error } = await admin.from("visibility_daily").upsert(row, { onConflict: "project_id,metric_date,topic,llm_provider,tracking_location" });
      if (error) throw new Error("METRICS_WRITE_FAILED for " + topic + ": " + error.message);
      const providerRow = { ...row, llm_provider: "chatgpt" };
      const { error: providerError } = await admin.from("visibility_daily").upsert(providerRow, { onConflict: "project_id,metric_date,topic,llm_provider,tracking_location" });
      if (providerError) throw new Error("PROVIDER_METRICS_WRITE_FAILED for " + topic + ": " + providerError.message);
    }

        const extractionFailures = succeeded.filter((result) =>
      (result.response_analysis as Record<string, unknown> | undefined)?.status !== "completed"
    ).length;
    const status = failed.length === 0 && extractionFailures === 0
      ? "completed"
      : succeeded.length ? "partial" : "failed";
    const runIssues = [
      ...(failed.length ? [String(failed.length) + " prompt(s) failed"] : []),
      ...(extractionFailures ? [String(extractionFailures) + " response analysis item(s) failed"] : []),
    ];
    await admin.from("tracking_runs").update({
      status, completed_prompts: succeeded.length, failed_prompts: failed.length,
      error_message: runIssues.length ? runIssues.join("; ") + "." : null,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return json({
      mode, run_id: runId, status, total_prompts: results.length, completed_prompts: succeeded.length, failed_prompts: failed.length,
      analysis_failures: extractionFailures,
      visibility_score: succeeded.length ? Math.round(succeeded.filter((r) => r.brand_mentioned).length / succeeded.length * 1000) / 10 : 0,
      message: extractionFailures ? "Tracking completed with response-analysis failures; inspect the run before using derived metrics." : "ChatGPT tracking run finished.",
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