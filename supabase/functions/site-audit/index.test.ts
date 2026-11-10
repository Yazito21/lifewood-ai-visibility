import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type AuditContext, type AuditDeps, handleRequest, type HandlerDeps, runAudit } from "./index.ts";
import type { OpenRouterResult } from "../_shared/openrouter.ts";

const words = (n: number) => Array.from({ length: n }, (_, i) => "word" + i).join(" ");

const brandSite: Record<string, { body: string; type: string }> = {
  "https://brand.com/": {
    type: "text/html",
    body: `<html lang="en"><head><title>Brand data annotation services</title><meta name="viewport" content="width=device-width">
      <link rel="canonical" href="https://brand.com/"><script type="application/ld+json">{"@type":"Organization","sameAs":["https://www.linkedin.com/company/brand"]}</script></head>
      <body><h1>Brand</h1><h2>What is Brand?</h2><p>Brand is a data annotation company founded in 2004. ${words(80)}</p><a href="/about">About</a></body></html>`,
  },
  "https://brand.com/robots.txt": { type: "text/plain", body: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:\nSitemap: https://brand.com/sitemap.xml" },
  "https://brand.com/sitemap.xml": { type: "application/xml", body: "<urlset><url><loc>https://brand.com/about</loc></url><url><loc>https://brand.com/blog/post-1</loc></url></urlset>" },
  "https://brand.com/about": { type: "text/html", body: `<html><head><title>About Brand</title></head><body><h1>About</h1><p>${words(320)}</p></body></html>` },
  "https://brand.com/blog/post-1": { type: "text/html", body: `<html><head><title>Post</title></head><body><h1>Post</h1><p>${words(200)}</p></body></html>` },
  "https://rival.com/": { type: "text/html", body: `<html><head><title>Rival</title><script type="application/ld+json">{"@type":"Organization"}</script></head><body><p>${words(300)}</p></body></html>` },
  "https://rival.com/llms.txt": { type: "text/plain", body: "# Rival\n> r\n## S\n- [x](https://rival.com/x)" },
};

function fakeFetch(site: Record<string, { body: string; type: string }>, failing: string[] = []): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (failing.some((prefix) => url.startsWith(prefix))) return Promise.reject(new TypeError("down"));
    if (url.includes("wikipedia.org") || url.includes("wikidata.org")) {
      return Promise.resolve(new Response(JSON.stringify({ query: { search: [] }, search: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    const page = site[url];
    return Promise.resolve(page
      ? new Response(page.body, { status: 200, headers: { "content-type": page.type } })
      : new Response("missing", { status: 404 }));
  }) as typeof fetch;
}

const aiReply = (text: string): OpenRouterResult => ({ text, model: "m", promptTokens: 1, completionTokens: 1, cost: 0.001 });
const eeatJson = JSON.stringify({
  experience: { score: 10, evidence: "e" }, expertise: { score: 15, evidence: "x" },
  authoritativeness: { score: 5, evidence: "a" }, trustworthiness: { score: 20, evidence: "t" },
});
const narrativeJson = JSON.stringify({ executiveSummary: { position: ["Visible in AI answers."] }, competitorSummary: "Rival leads." });

function context(overrides: Partial<AuditContext["snapshot"]> = {}): AuditContext {
  return {
    reportId: "r1",
    brandName: "Brand",
    website: "https://brand.com",
    snapshot: {
      version: 1,
      overall: { visibilityScore: 42.5 },
      byEngine: [{ engine: "chatgpt", visibilityScore: 40 }],
      competitors: [
        { name: "Brand", website: "https://brand.com", isTracked: true },
        { name: "Rival", website: "https://rival.com", isTracked: false },
        { name: "Down", website: "https://down.com", isTracked: false },
        { name: "NoSite", website: null, isTracked: false },
      ],
      thirdPartyHosts: 4,
      ...overrides,
    },
  };
}

function deps(options: { fetch?: typeof fetch; callAi?: AuditDeps["callAi"] } = {}) {
  const patches: Record<string, unknown>[] = [];
  const usage: string[] = [];
  let calls = 0;
  const timeouts: number[] = [];
  const d: AuditDeps = {
    fetch: options.fetch ?? fakeFetch(brandSite, ["https://down.com"]),
    callAi: options.callAi ?? ((messages, _maxTokens, timeoutMs) => {
      calls++;
      timeouts.push(timeoutMs);
      return Promise.resolve(aiReply(messages[0].content.includes("E-E-A-T") ? eeatJson : narrativeJson));
    }),
    save: (patch) => { patches.push(patch); return Promise.resolve(); },
    logUsage: (action) => { usage.push(action); return Promise.resolve(); },
    now: () => 0,
  };
  return { d, patches, usage, calls: () => calls, timeouts };
}

Deno.test("happy path saves steps in order and completes", async () => {
  const { d, patches, usage } = deps();
  await runAudit(context(), d);
  const steps = patches.map((p) => p.step).filter(Boolean);
  assertEquals([...new Set(steps)], ["crawling", "checking", "competitors", "scoring_content", "writing", "saving"]);
  const last = patches.at(-1)!;
  assertEquals(last.status, "completed");
  assertEquals(typeof last.geo_score, "number");
  assertEquals(typeof last.seo_score, "number");
  assertEquals(last.ai_visibility_score, 42.5);
  assertEquals(last.ai_cost_usd, 0.002);
  assertEquals(usage, ["audit_eeat", "audit_narrative"]);
  const audit = last.audit as any;
  assertEquals(audit.site.reachable, true);
  assertEquals(audit.site.robots.crawlers.GPTBot, "blocked");
  assertEquals(audit.site.knowledgeAssets.blog, 1);
  assertEquals(audit.scores.eeat, 50);
  assertEquals(audit.findings.technical.some((f: string) => f.includes("GPTBot")), true);
  assertEquals((last.narrative as any).competitorSummary, "Rival leads.");
});

Deno.test("audit with unreachable site still completes", async () => {
  const { d, patches } = deps({ fetch: fakeFetch(brandSite, ["https://brand.com"]) });
  await runAudit(context(), d);
  const last = patches.at(-1)!;
  assertEquals(last.status, "completed");
  assertEquals((last.audit as any).site.reachable, false);
  assertEquals(typeof (last.audit as any).site.error, "string");
  assertEquals(last.seo_score, null);
  assertEquals(last.ai_visibility_score, 42.5);
});

Deno.test("project without a website completes with a reason", async () => {
  const { d, patches } = deps();
  await runAudit({ ...context(), website: null }, d);
  const audit = patches.at(-1)!.audit as any;
  assertEquals(audit.site.reachable, false);
  assertEquals(audit.site.error, "No website is set for this project.");
});

Deno.test("AI failure falls back", async () => {
  const { d, patches } = deps({ callAi: () => Promise.reject(new Error("AI_CREDIT_EXHAUSTED")) });
  await runAudit(context(), d);
  const last = patches.at(-1)!;
  assertEquals(last.status, "completed");
  assertEquals((last.narrative as any).fallback, true);
  assertEquals((last.audit as any).notices.length, 1);
  assertEquals((last.audit as any).scores.eeat, null);
});

Deno.test("competitor failure shows unavailable", async () => {
  const { d, patches } = deps();
  await runAudit(context(), d);
  const competitors = (patches.at(-1)!.audit as any).competitors;
  assertEquals(competitors.map((c: any) => [c.name, c.reachable]), [["Rival", true], ["Down", false]]);
  const rival = competitors[0];
  assertEquals(rival.llmsTxt, true);
  assertEquals(rival.schemaTypes, ["Organization"]);
  assertEquals(rival.aiCrawlersAllowed, rival.aiCrawlersTotal);
});

Deno.test("past the time budget the AI steps are skipped", async () => {
  const { d, patches, calls } = deps();
  let t = 0;
  d.now = () => (t += 60_000);
  await runAudit(context(), d);
  const last = patches.at(-1)!;
  assertEquals(last.status, "completed");
  assertEquals(calls(), 0);
  assertEquals((last.narrative as any).fallback, true);
  assertEquals((last.audit as any).budgetSkipped.length > 0, true);
});

Deno.test("unexpected error marks the report failed", async () => {
  const { d, patches } = deps();
  d.save = (patch) => {
    patches.push(patch);
    if (patch.step === "competitors") return Promise.reject(new Error("db down"));
    return Promise.resolve();
  };
  await runAudit(context(), d);
  assertEquals(patches.at(-1)!.status, "failed");
});

// ---- request handling ----

function handlerDeps(role: { profile?: string; member?: string; createdBy?: string }, insert: "ok" | "conflict" | "stale" = "ok") {
  const started: string[] = [];
  let expired = false;
  const h: HandlerDeps = {
    userIdForToken: (token) => Promise.resolve(token === "good" ? "u1" : null),
    roles: () => Promise.resolve({ profileRole: role.profile ?? null, memberRole: role.member ?? null }),
    project: (id) => Promise.resolve(id === "p1" ? { id: "p1", brand_name: "Brand", brand_domains: ["brand.com"], created_by: role.createdBy ?? "someone-else" } : null),
    expireStale: () => { expired = true; return Promise.resolve(); },
    insertReport: () => Promise.resolve(insert === "ok" || (insert === "stale" && expired) ? { id: "r1" } : { conflict: true }),
    startAudit: (ctx) => { started.push(ctx.reportId); },
  };
  return { h, started };
}

const body = (extra: Record<string, unknown> = {}) => JSON.stringify({
  action: "start", project_id: "p1", period_start: "2026-10-01", period_end: "2026-10-30", period_label: "Last 30 Days",
  tracking_location: "MY", snapshot: { version: 1, overall: { visibilityScore: 1 }, byEngine: [], competitors: [], thirdPartyHosts: 0 }, ...extra,
});
const request = (b: string, token = "good") => new Request("http://x/site-audit", { method: "POST", headers: { Authorization: "Bearer " + token }, body: b });

Deno.test("starts a report for a project admin", async () => {
  const { h, started } = handlerDeps({ member: "admin" });
  const res = await handleRequest(request(body()), h);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { report_id: "r1" });
  assertEquals(started, ["r1"]);
});

Deno.test("rejects viewers", async () => {
  const { h, started } = handlerDeps({ profile: "viewer", member: "viewer" });
  assertEquals((await handleRequest(request(body()), h)).status, 403);
  assertEquals(started, []);
});

Deno.test("rejects bad tokens", async () => {
  const { h } = handlerDeps({ profile: "superadmin" });
  assertEquals((await handleRequest(request(body(), "bad"), h)).status, 401);
});

Deno.test("rejects oversized snapshot", async () => {
  const { h } = handlerDeps({ profile: "superadmin" });
  const res = await handleRequest(request(body({ snapshot: { version: 1, padding: "x".repeat(600_000) } })), h);
  assertEquals(res.status, 400);
});

Deno.test("rejects bad dates and wrong snapshot version", async () => {
  const { h } = handlerDeps({ profile: "superadmin" });
  assertEquals((await handleRequest(request(body({ period_start: "nope" })), h)).status, 400);
  assertEquals((await handleRequest(request(body({ period_start: "2026-11-02", period_end: "2026-11-01" })), h)).status, 400);
  assertEquals((await handleRequest(request(body({ snapshot: { version: 2 } })), h)).status, 400);
});

Deno.test("second report while one runs is rejected", async () => {
  const { h } = handlerDeps({ member: "admin" }, "conflict");
  const res = await handleRequest(request(body()), h);
  assertEquals(res.status, 409);
  assertEquals((await res.json()).message, "A report is already being generated for this project.");
});

Deno.test("unknown project is 404", async () => {
  const { h } = handlerDeps({ profile: "superadmin" });
  assertEquals((await handleRequest(request(body({ project_id: "p2" })), h)).status, 404);
});

Deno.test("stale running report is expired before starting", async () => {
  const { h } = handlerDeps({ member: "admin" }, "stale");
  assertEquals((await handleRequest(request(body()), h)).status, 200);
});

Deno.test("rejects platform admin who is not a project member", async () => {
  const { h, started } = handlerDeps({ profile: "admin" });
  assertEquals((await handleRequest(request(body()), h)).status, 403);
  assertEquals(started, []);
});

Deno.test("allows platform admin who created the project", async () => {
  const { h } = handlerDeps({ profile: "admin", createdBy: "u1" });
  assertEquals((await handleRequest(request(body()), h)).status, 200);
});

Deno.test("AI calls get a timeout within the remaining budget", async () => {
  const { d, timeouts } = deps();
  let t = 0;
  d.now = () => (t += 20_000);
  await runAudit(context(), d);
  assertEquals(timeouts.length > 0, true);
  for (const ms of timeouts) assertEquals(ms > 0 && ms <= 30_000, true);
});

Deno.test("unreachable site has no GEO score", async () => {
  const { d, patches } = deps({ fetch: fakeFetch(brandSite, ["https://brand.com"]) });
  await runAudit(context(), d);
  assertEquals(patches.at(-1)!.geo_score, null);
});
