import { createClient } from "npm:@supabase/supabase-js@2";
import { htmlToText } from "../_shared/html-text.ts";
import { callOpenRouter, type ChatMessage, type OpenRouterResult } from "../_shared/openrouter.ts";
import { findSocialProfiles, lookupWikidata, lookupWikipedia, manualCheckLinks } from "./brand-authority.ts";
import { type PageCitability, scorePageCitability } from "./citability.ts";
import { checkCompetitor, type CompetitorCheck } from "./competitors.ts";
import { crawlSite } from "./crawl.ts";
import { parseRobots } from "./crawlers.ts";
import { buildFindings } from "./findings.ts";
import { countKnowledgeAssets } from "./knowledge-assets.ts";
import { analyzeLlmsTxt } from "./llms-txt.ts";
import { allowedNumbers, eeatMessages, fallbackNarrative, type Narrative, narrativeMessages, parseEeat, parseNarrative } from "./narrative.ts";
import { extractSchema, mergeSchema } from "./schema.ts";
import {
  brandScore, citabilityScore, eeatScore, geoScore, platformScore, schemaScore, seoHealth, technicalScore,
} from "./scoring.ts";
import { checkPage, checkSiteWide, type PageCheck } from "./technical.ts";
import type { EeatResult } from "./types.ts";

// ---------- types ----------

/** The parts of the browser-built AI visibility snapshot the audit uses. The full snapshot is stored as-is. */
export type SnapshotLite = {
  version: 1;
  overall?: { visibilityScore?: number | null };
  byEngine?: { engine: string; visibilityScore: number | null }[];
  competitors?: { name: string; website: string | null; isTracked: boolean }[];
  thirdPartyHosts?: number;
  [key: string]: unknown;
};

export type AuditContext = { reportId: string; brandName: string; website: string | null; snapshot: SnapshotLite };

export type AuditDeps = {
  fetch: typeof fetch;
  /** timeoutMs caps each attempt; retry=false when there is no time for a second attempt. */
  callAi: (messages: ChatMessage[], maxTokens: number, timeoutMs: number, retry: boolean) => Promise<OpenRouterResult>;
  save: (patch: Record<string, unknown>) => Promise<void>;
  logUsage: (action: "audit_eeat" | "audit_narrative", result: OpenRouterResult) => Promise<void>;
  now: () => number;
};

export type HandlerDeps = {
  userIdForToken: (token: string) => Promise<string | null>;
  roles: (userId: string, projectId: string) => Promise<{ profileRole: string | null; memberRole: string | null }>;
  project: (projectId: string) => Promise<{ id: string; brand_name: string; brand_domains: string[] | null; created_by: string | null } | null>;
  /** Marks reports stuck in queued/running for over 10 minutes as failed, so they no longer block new reports. */
  expireStale: (projectId: string) => Promise<void>;
  insertReport: (row: Record<string, unknown>) => Promise<{ id: string } | { conflict: true } | { error: string }>;
  startAudit: (ctx: AuditContext) => void;
};

// ---------- constants ----------

const MAX_SNAPSHOT_BYTES = 512 * 1024;
// Supabase Free plan stops a function after 150 s of wall-clock time; the job keeps 15 s in reserve.
const TOTAL_BUDGET_MS = 135_000;
const CRAWL_BUDGET_MS = 60_000;
const COMPETITOR_START_LIMIT_MS = 80_000;
const MIN_AI_WINDOW_MS = 20_000;
const AI_TIMEOUT_MS = 30_000;
const SAFETY_MS = 5_000;
const MAX_COMPETITORS = 3;

const AI_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: "The AI text could not be written because the OpenRouter key is not set up. Scores and findings are complete.",
  AI_CREDIT_EXHAUSTED: "The AI text could not be written because AI credit has run out. Scores and findings are complete.",
  AI_UNAVAILABLE: "The AI did not respond, so this report lists the findings without AI-written text.",
  MODEL_JSON_INVALID: "The AI returned an unreadable answer, so this report lists the findings without AI-written text.",
};

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

// ---------- audit job ----------

/** Calls the model within the remaining time; retries (network or bad JSON) only when there is time for it. */
async function askJson<T>(deps: AuditDeps, remaining: () => number, action: "audit_eeat" | "audit_narrative", messages: ChatMessage[], maxTokens: number, parse: (text: string) => T): Promise<{ value: T; cost: number }> {
  let cost = 0;
  for (let attempt = 0; ; attempt++) {
    const left = remaining();
    if (left < MIN_AI_WINDOW_MS) throw new Error("AI_TIME_BUDGET");
    const timeout = Math.min(AI_TIMEOUT_MS, left - SAFETY_MS);
    const result = await deps.callAi(messages, maxTokens, timeout, left > 2 * timeout + SAFETY_MS);
    cost += result.cost ?? 0;
    await deps.logUsage(action, result);
    try {
      return { value: parse(result.text), cost };
    } catch (error) {
      if (attempt >= 1 || !(error instanceof Error) || error.message !== "MODEL_JSON_INVALID") throw error;
      if (remaining() < MIN_AI_WINDOW_MS) throw error;
    }
  }
}

function aiCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return code in AI_MESSAGES ? code : "AI_UNAVAILABLE";
}

/** Crawl → checks → competitors → E-E-A-T → narrative → save. Every stage saves its step first. */
export async function runAudit(ctx: AuditContext, deps: AuditDeps): Promise<void> {
  try {
    const start = deps.now();
    const elapsed = () => deps.now() - start;
    const remaining = () => TOTAL_BUDGET_MS - elapsed();
    const notices: string[] = [];
    const budgetSkipped: string[] = [];
    const snapshot = ctx.snapshot;
    const byEngine = Array.isArray(snapshot.byEngine) ? snapshot.byEngine : [];
    const thirdPartyHosts = Number(snapshot.thirdPartyHosts) || 0;

    await deps.save({ status: "running", step: "crawling" });
    const crawl = ctx.website
      ? await crawlSite(ctx.website, { fetch: deps.fetch, deadline: Date.now() + CRAWL_BUDGET_MS })
      : { origin: "", reachable: false, error: "No website is set for this project.", homepage: null, pages: [], robotsText: null, llmsText: null, sitemapUrls: [] };

    await deps.save({ step: "checking" });
    const htmlPages = crawl.homepage ? [crawl.homepage, ...crawl.pages] : [];
    const robots = parseRobots(crawl.robotsText);
    const llms = analyzeLlmsTxt(crawl.llmsText);
    const pageChecks: PageCheck[] = htmlPages.map(checkPage);
    const siteChecks = checkSiteWide(crawl.origin, pageChecks[0] ?? null, robots, crawl.sitemapUrls.length > 0);
    const schema = mergeSchema(htmlPages.map((page) => extractSchema(page.html)));
    const citability: (PageCitability & { url: string })[] = htmlPages.map((page) => ({ url: page.url, ...scorePageCitability(page.html) }));
    const knowledgeAssets = countKnowledgeAssets(crawl.sitemapUrls);
    const [wikipedia, wikidata] = crawl.reachable
      ? await Promise.all([lookupWikipedia(ctx.brandName, { fetch: deps.fetch }), lookupWikidata(ctx.brandName, { fetch: deps.fetch })])
      : [{ found: false, title: null, url: null }, { found: false, id: null }];
    const brandAuthority = { wikipedia, wikidata, social: findSocialProfiles(crawl.homepage?.html ?? "", schema.sameAs) };

    await deps.save({ step: "competitors" });
    let competitors: CompetitorCheck[] = [];
    const rivals = (snapshot.competitors ?? []).filter((c) => !c.isTracked && c.website).slice(0, MAX_COMPETITORS);
    if (rivals.length && elapsed() > COMPETITOR_START_LIMIT_MS) budgetSkipped.push("Competitor website checks");
    else competitors = await Promise.all(rivals.map((c) => checkCompetitor({ name: c.name, website: c.website as string }, deps.fetch)));

    await deps.save({ step: "scoring_content" });
    let aiCost = 0;
    let eeat: EeatResult | null = null;
    const pageTexts = htmlPages.slice(0, 5)
      .map((page) => ({ url: page.url, text: htmlToText(page.html, 8000) ?? "" }))
      .filter((page) => page.text);
    let aiFailure: string | null = null;
    if (pageTexts.length && remaining() < MIN_AI_WINDOW_MS) budgetSkipped.push("Content quality (E-E-A-T) scoring");
    else if (pageTexts.length) {
      try {
        const result = await askJson(deps, remaining, "audit_eeat", eeatMessages(ctx.brandName, pageTexts), 700, parseEeat);
        eeat = result.value;
        aiCost += result.cost;
      } catch (error) {
        if (error instanceof Error && error.message === "AI_TIME_BUDGET") budgetSkipped.push("Content quality (E-E-A-T) scoring");
        else aiFailure = aiCode(error);
      }
    }

    const scores = {
      citability: citabilityScore(citability.filter((p) => p.passages > 0)),
      brand: crawl.reachable ? brandScore(brandAuthority, thirdPartyHosts) : null,
      eeat: eeatScore(eeat),
      technical: crawl.reachable ? technicalScore(robots, llms, siteChecks) : null,
      schema: crawl.reachable ? schemaScore(schema) : null,
      platform: platformScore(byEngine),
    };
    const geo = geoScore(scores);
    const seo = crawl.reachable ? seoHealth(siteChecks, pageChecks) : null;
    const findings = buildFindings({
      robots, llms, site: siteChecks, pages: pageChecks, citability, schema, brand: brandAuthority,
      assets: knowledgeAssets, eeat, byEngine, thirdPartyHosts,
    });
    if (!crawl.reachable) {
      for (const key of ["technical", "seo", "citability", "schema", "eeat", "brand"] as const) findings[key] = [];
    }

    await deps.save({ step: "writing" });
    let narrative: Narrative;
    const input = {
      brand: ctx.brandName,
      facts: {
        aiVisibility: snapshot,
        website: crawl.reachable ? { origin: crawl.origin, pagesAudited: pageChecks.length } : { notAudited: crawl.error },
        scores: { ...scores, geo, seo },
        findings,
        competitorWebsites: competitors,
      },
    };
    if (remaining() < MIN_AI_WINDOW_MS) {
      budgetSkipped.push("AI-written report text");
      narrative = fallbackNarrative(findings);
    } else if (aiFailure && aiFailure !== "MODEL_JSON_INVALID") {
      narrative = fallbackNarrative(findings);
    } else {
      try {
        const allowed = allowedNumbers(input);
        const result = await askJson(deps, remaining, "audit_narrative", narrativeMessages(input), 1800, (text) => parseNarrative(text, allowed));
        narrative = result.value;
        aiCost += result.cost;
      } catch (error) {
        if (error instanceof Error && error.message === "AI_TIME_BUDGET") budgetSkipped.push("AI-written report text");
        else aiFailure = aiCode(error);
        narrative = fallbackNarrative(findings);
      }
    }
    if (aiFailure) notices.push(AI_MESSAGES[aiFailure]);

    await deps.save({ step: "saving" });
    const audit = {
      site: {
        origin: crawl.origin,
        reachable: crawl.reachable,
        ...(crawl.error ? { error: crawl.error } : {}),
        robots,
        llmsTxt: llms,
        siteChecks,
        pages: pageChecks,
        citability,
        schema,
        knowledgeAssets,
        brandAuthority,
        manualCheckLinks: manualCheckLinks(ctx.brandName),
        eeat,
      },
      scores: { ...scores, geo, seo },
      findings,
      competitors,
      notices,
      budgetSkipped,
    };
    const visibility = snapshot.overall?.visibilityScore;
    await deps.save({
      status: "completed",
      step: "saving",
      audit,
      narrative,
      ai_visibility_score: typeof visibility === "number" ? visibility : null,
      geo_score: geo,
      seo_score: seo,
      ai_cost_usd: Math.round(aiCost * 1e6) / 1e6,
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("SITE_AUDIT_FAILED", error);
    await deps.save({ status: "failed", error: "The report could not be generated. Try again." }).catch(() => {});
  }
}

// ---------- request handling ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: unknown): value is string => typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "AUTHORIZATION_TOKEN_MISSING" }, 401);
    const userId = await deps.userIdForToken(token);
    if (!userId) return json({ error: "AUTH_VALIDATION_FAILED" }, 401);

    const raw = await req.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "INVALID_REQUEST", message: "The request is not valid JSON." }, 400);
    }
    const projectId = String(body?.project_id ?? "");
    if (body?.action !== "start" || !projectId) return json({ error: "INVALID_REQUEST", message: "Missing project or action." }, 400);
    if (!validDate(body.period_start) || !validDate(body.period_end) || body.period_start > body.period_end) {
      return json({ error: "INVALID_REQUEST", message: "Choose a valid reporting period." }, 400);
    }
    const snapshot = body.snapshot as SnapshotLite | undefined;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || snapshot.version !== 1) {
      return json({ error: "INVALID_REQUEST", message: "The AI visibility data is missing. Reload and try again." }, 400);
    }
    if (new TextEncoder().encode(JSON.stringify(snapshot)).length > MAX_SNAPSHOT_BYTES) {
      return json({ error: "INVALID_REQUEST", message: "The AI visibility data is too large." }, 400);
    }

    const [roles, project] = await Promise.all([deps.roles(userId, projectId), deps.project(projectId)]);
    // Same rule as public.can_edit_project(): superadmin, project admin, or the platform admin who created the project.
    const canEdit = roles.profileRole === "superadmin" ||
      ["superadmin", "admin"].includes(roles.memberRole ?? "") ||
      (roles.profileRole === "admin" && project?.created_by === userId);
    if (!canEdit) return json({ error: "Not authorized." }, 403);
    if (!project) return json({ error: "PROJECT_NOT_FOUND" }, 404);

    await deps.expireStale(projectId);

    const inserted = await deps.insertReport({
      project_id: projectId,
      requested_by: userId,
      period_start: body.period_start,
      period_end: body.period_end,
      period_label: typeof body.period_label === "string" ? body.period_label.slice(0, 40) : null,
      tracking_location: typeof body.tracking_location === "string" ? body.tracking_location.slice(0, 20) : "GLOBAL",
      visibility_snapshot: snapshot,
      status: "running",
      step: "crawling",
    });
    if ("conflict" in inserted) return json({ error: "REPORT_RUNNING", message: "A report is already being generated for this project." }, 409);
    if ("error" in inserted) return json({ error: "REPORT_CREATE_FAILED", message: "The report could not be started. Try again." }, 500);

    deps.startAudit({ reportId: inserted.id, brandName: project.brand_name, website: project.brand_domains?.[0] ?? null, snapshot });
    return json({ report_id: inserted.id });
  } catch (error) {
    console.error("SITE_AUDIT_REQUEST_FAILED", error);
    return json({ error: "SITE_AUDIT_FAILED", message: "Something went wrong. Try again." }, 500);
  }
}

// ---------- runtime wiring ----------

function getConfiguredKey(primary: string, jsonEnv: string) {
  const direct = Deno.env.get(primary);
  if (direct) return direct;
  const raw = Deno.env.get(jsonEnv);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.default ? (Deno.env.get(parsed.default) ?? null) : null;
  } catch {
    return null;
  }
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function liveDeps(): HandlerDeps {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = getConfiguredKey("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? getConfiguredKey("SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS");
  if (!supabaseUrl || !publishableKey || !secretKey) throw new Error("SUPABASE_CLIENT_CONFIG_MISSING");
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let requester: { userId: string; projectId: string } | null = null;

  return {
    userIdForToken: async (token) => {
      const response = await fetch(supabaseUrl + "/auth/v1/user", { headers: { apikey: publishableKey, Authorization: "Bearer " + token } });
      if (!response.ok) return null;
      return (await response.json())?.id ?? null;
    },
    roles: async (userId, projectId) => {
      requester = { userId, projectId };
      const [{ data: profile }, { data: member }] = await Promise.all([
        admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
        admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle(),
      ]);
      return { profileRole: profile?.role ?? null, memberRole: member?.role ?? null };
    },
    project: async (projectId) => {
      const { data } = await admin.from("projects").select("id,brand_name,brand_domains,created_by").eq("id", projectId).maybeSingle();
      return data ?? null;
    },
    expireStale: async (projectId) => {
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { error } = await admin.from("audit_reports")
        .update({ status: "failed", error: "The report stopped making progress. Generate it again." })
        .eq("project_id", projectId).in("status", ["queued", "running"]).lt("updated_at", cutoff);
      if (error) console.error("EXPIRE_STALE_FAILED", error.message);
    },
    insertReport: async (row) => {
      const { data, error } = await admin.from("audit_reports").insert(row).select("id").single();
      if (error?.code === "23505") return { conflict: true };
      if (error || !data) return { error: error?.message ?? "insert failed" };
      return { id: data.id };
    },
    startAudit: (ctx) => {
      const who = requester;
      const job = runAudit(ctx, {
        fetch,
        callAi: (messages, maxTokens, timeoutMs, retry) => callOpenRouter(messages, maxTokens, { timeoutMs, retry }),
        save: async (patch) => {
          const { error } = await admin.from("audit_reports").update(patch).eq("id", ctx.reportId);
          if (error) throw new Error("REPORT_SAVE_FAILED: " + error.message);
        },
        logUsage: async (action, result) => {
          const { error } = await admin.from("ai_usage_log").insert({
            project_id: who?.projectId, user_id: who?.userId, action, model: result.model,
            prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens, cost_usd: result.cost,
          });
          if (error) console.error("AI_USAGE_LOG_FAILED", error.message);
        },
        now: () => Date.now(),
      });
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job);
    },
  };
}

if (import.meta.main) {
  Deno.serve((req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      return handleRequest(req, liveDeps());
    } catch (error) {
      console.error("SITE_AUDIT_CONFIG", error);
      return json({ error: "SUPABASE_CLIENT_CONFIG_MISSING" }, 500);
    }
  });
}
