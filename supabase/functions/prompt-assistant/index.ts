import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { htmlToText } from "./html-text.ts";
import { type BrandProfile, parseProfile, parseSuggestions } from "./llm-json.ts";
import { callOpenRouter, type ChatMessage, type OpenRouterResult } from "./openrouter.ts";
import { filterSuggestions, type SuggestionMode } from "./prompt-dedupe.ts";

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

function getConfiguredKey(primary: string, jsonEnv: string) {
  const direct = Deno.env.get(primary);
  if (direct) return direct;
  const raw = Deno.env.get(jsonEnv);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.default ? (Deno.env.get(parsed.default) ?? null) : null;
  } catch { return null; }
}

const errorStatus: Record<string, number> = {
  AI_NOT_CONFIGURED: 500,
  AI_CREDIT_EXHAUSTED: 402,
  AI_UNAVAILABLE: 502,
  MODEL_JSON_INVALID: 502,
};

const errorMessage: Record<string, string> = {
  AI_NOT_CONFIGURED: "The AI assistant isn't set up yet. An admin needs to add the OpenRouter key.",
  AI_CREDIT_EXHAUSTED: "AI credit has run out. Top up OpenRouter or ask an admin.",
  AI_UNAVAILABLE: "The AI didn't respond. Try again.",
  MODEL_JSON_INVALID: "The AI returned an unreadable answer. Try again.",
};

const MAX_COUNT = 5;
const EXTRA_CANDIDATES = 3;
const MAX_EXISTING_IN_PROMPT = 50;
const WEBSITE_TIMEOUT_MS = 8_000;

type Project = {
  id: string;
  brand_name: string;
  brand_description: string | null;
  brand_domains: string[] | null;
  brand_terms: string[] | null;
  topics: string[] | null;
  tracking_locations: string[] | null;
  brand_profile: BrandProfile | null;
};

type Context = { admin: SupabaseClient; project: Project; userId: string };

async function logUsage(ctx: Context, action: "analyze" | "generate", result: OpenRouterResult) {
  const { error } = await ctx.admin.from("ai_usage_log").insert({
    project_id: ctx.project.id, user_id: ctx.userId, action, model: result.model,
    prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens, cost_usd: result.cost,
  });
  if (error) console.error("AI_USAGE_LOG_FAILED", error.message);
}

/** Calls the model and parses its reply, retrying once when the reply is not valid JSON. */
async function askJson<T>(ctx: Context, action: "analyze" | "generate", messages: ChatMessage[], maxTokens: number, parse: (text: string) => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const result = await callOpenRouter(messages, maxTokens);
    await logUsage(ctx, action, result);
    try {
      return parse(result.text);
    } catch (error) {
      if (attempt >= 1 || !(error instanceof Error) || error.message !== "MODEL_JSON_INVALID") throw error;
    }
  }
}

function location(project: Project) {
  return project.tracking_locations?.[0] || "GLOBAL";
}

async function fetchHomepageText(domain: string | undefined): Promise<string | null> {
  if (!domain) return null;
  const url = /^https?:\/\//i.test(domain) ? domain : "https://" + domain.replace(/^\/+/, "");
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "LifewoodAIVisibilityBot/1.0", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(WEBSITE_TIMEOUT_MS),
    });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) return null;
    return htmlToText(await response.text());
  } catch {
    return null;
  }
}

async function analyze(ctx: Context) {
  const { project } = ctx;
  const homepage = await fetchHomepageText(project.brand_domains?.[0]);
  const source = homepage ? "website" : "description_only";
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "You analyse companies for an AI search visibility tool. Reply with JSON only, shaped as " +
        '{"summary": string (2-3 sentences), "offerings": string[], "audiences": string[], "markets": string[], "differentiators": string[]}. ' +
        "Each list has at most 6 short items. Use only facts supported by the input; leave a list empty when unknown.",
    },
    {
      role: "user",
      content: [
        `Brand: ${project.brand_name}`,
        `Description: ${project.brand_description || "Not provided"}`,
        `Website: ${project.brand_domains?.[0] || "Not provided"}`,
        `Tracked topics: ${(project.topics ?? []).join(", ") || "Not provided"}`,
        `Market (ISO country code, GLOBAL = worldwide): ${location(project)}`,
        `Homepage text: ${homepage ?? "Website text unavailable"}`,
      ].join("\n"),
    },
  ];
  const profile = await askJson(ctx, "analyze", messages, 600, parseProfile);
  const updatedAt = new Date().toISOString();
  const { error } = await ctx.admin.from("projects")
    .update({ brand_profile: profile, brand_profile_updated_at: updatedAt }).eq("id", project.id);
  if (error) console.error("BRAND_PROFILE_SAVE_FAILED", error.message);
  project.brand_profile = profile;
  return { profile, source, updated_at: updatedAt };
}

function generationMessages(project: Project, profile: BrandProfile, topic: string, mode: SuggestionMode, language: string, wanted: number, avoid: string[]): ChatMessage[] {
  const modeRule = mode === "discovery"
    ? `Never mention ${project.brand_name}, its website or any of its product names. Write the questions a buyer asks before they know which company to choose.`
    : `Every question names ${project.brand_name} and asks how AI assistants see it (reputation, reviews, pricing, comparisons with alternatives).`;
  return [
    {
      role: "system",
      content: "You write realistic questions people type into AI assistants such as ChatGPT, Gemini and Perplexity. " +
        'Reply with JSON only: {"prompts": string[]}. Each question is one sentence, natural and specific, under 25 words.',
    },
    {
      role: "user",
      content: [
        `Write ${wanted} questions about the topic "${topic}" in ${language}.`,
        `Market (ISO country code, GLOBAL = worldwide): ${location(project)}. Mention the market only where a real buyer would.`,
        modeRule,
        "Vary the intent: recommendations, comparisons, how-to, cost, trust and suitability for a specific need.",
        `Company profile: ${JSON.stringify(profile)}`,
        avoid.length ? `Do not repeat or rephrase these existing questions:\n- ${avoid.join("\n- ")}` : "",
      ].filter(Boolean).join("\n"),
    },
  ];
}

async function generate(ctx: Context, body: Record<string, unknown>) {
  const { project } = ctx;
  const topic = String(body?.topic ?? "");
  const mode = String(body?.mode ?? "discovery") as SuggestionMode;
  const language = String(body?.language ?? "English").trim() || "English";
  const count = Math.min(MAX_COUNT, Math.max(1, Math.trunc(Number(body?.count ?? MAX_COUNT)) || MAX_COUNT));
  if (!(project.topics ?? []).includes(topic)) return json({ error: "INVALID_REQUEST", message: "Choose one of the project's topics." }, 400);
  if (mode !== "discovery" && mode !== "brand") return json({ error: "INVALID_REQUEST", message: "Unknown prompt type." }, 400);

  let profileSource: string | undefined;
  if (!project.brand_profile) profileSource = (await analyze(ctx)).source;
  const profile = project.brand_profile as BrandProfile;

  const { data: existingRows, error: existingError } = await ctx.admin.from("prompts")
    .select("prompt,topic").eq("project_id", project.id);
  if (existingError) return json({ error: "PROMPT_LOOKUP_FAILED", message: existingError.message }, 500);
  const existing = (existingRows ?? []).map((row: { prompt: string }) => row.prompt);
  const avoid = (existingRows ?? []).filter((row: { topic: string }) => row.topic === topic)
    .map((row: { prompt: string }) => row.prompt).slice(-MAX_EXISTING_IN_PROMPT);
  const brandTerms = [project.brand_name, ...(project.brand_terms ?? []), ...(project.brand_domains ?? [])];

  const kept: string[] = [];
  for (let round = 0; round < 2 && kept.length < count; round++) {
    const missing = count - kept.length;
    const candidates = await askJson(ctx, "generate",
      generationMessages(project, profile, topic, mode, language, missing + EXTRA_CANDIDATES, [...avoid, ...kept]), 500, parseSuggestions);
    kept.push(...filterSuggestions(candidates, [...existing, ...kept], { mode, brandTerms, limit: missing }));
  }

  return json({
    suggestions: kept.map((prompt) => ({ prompt, topic, language, mode })),
    ...(profileSource ? { profile_source: profileSource } : {}),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = getConfiguredKey("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? getConfiguredKey("SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS");
    if (!supabaseUrl || !publishableKey || !secretKey) return json({ error: "SUPABASE_CLIENT_CONFIG_MISSING" }, 500);

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "AUTHORIZATION_TOKEN_MISSING" }, 401);
    const userResponse = await fetch(supabaseUrl + "/auth/v1/user", { headers: { apikey: publishableKey, Authorization: "Bearer " + token } });
    if (!userResponse.ok) return json({ error: "AUTH_VALIDATION_FAILED" }, 401);
    const userId = (await userResponse.json())?.id;
    if (!userId) return json({ error: "AUTH_USER_MISSING" }, 401);

    const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const projectId = String(body?.project_id ?? "");
    if (!projectId || (action !== "analyze" && action !== "generate")) return json({ error: "INVALID_REQUEST", message: "Missing project or action." }, 400);

    const [{ data: profile }, { data: member }, { data: project, error: projectError }] = await Promise.all([
      admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
      admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle(),
      admin.from("projects")
        .select("id,brand_name,brand_description,brand_domains,brand_terms,topics,tracking_locations,brand_profile")
        .eq("id", projectId).maybeSingle(),
    ]);
    const canEdit = ["superadmin", "admin"].includes(profile?.role) || ["superadmin", "admin"].includes(member?.role);
    if (!canEdit) return json({ error: "Not authorized." }, 403);
    if (projectError || !project) return json({ error: "PROJECT_NOT_FOUND" }, 404);

    const ctx: Context = { admin, project: project as Project, userId };
    return action === "analyze" ? json(await analyze(ctx)) : await generate(ctx, body);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code in errorStatus) return json({ error: code, message: errorMessage[code] }, errorStatus[code]);
    console.error("PROMPT_ASSISTANT_FAILED", error);
    return json({ error: "PROMPT_ASSISTANT_FAILED", message: "Something went wrong. Try again." }, 500);
  }
});
