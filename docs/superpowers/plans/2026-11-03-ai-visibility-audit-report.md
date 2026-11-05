# AI Visibility & GEO Audit Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins generate a saved, editable, Lifewood-branded report per project — AI visibility from tracking data, competitor benchmark, GEO audit, SEO audit, current position, targets, with SVG charts — viewable in the app and downloadable as a 16:9 PDF.

**Architecture:** The browser gathers the AI visibility snapshot with the same queries the app pages use (extracted into `lib/`), then calls a new `site-audit` Edge Function. The function inserts an `audit_reports` row, replies at once, and finishes in the background (`EdgeRuntime.waitUntil`): crawl → deterministic checks ported from geo-seo-claude → competitor homepage checks → two OpenRouter calls (E-E-A-T, narrative) → scores → save. The report page polls the row every 3 s and renders 11 print-ready pages.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, Tailwind 4, Supabase (Postgres + RLS, Edge Functions on Deno), OpenRouter `google/gemini-2.5-flash-lite`. Tests: `node --test lib/*.test.ts`, `npx -y deno test supabase/functions`.

**Spec:** `docs/superpowers/specs/2026-11-02-ai-visibility-audit-report-design.md`

## Global Constraints

- UI and report copy say **"AI visibility"**, never "AEO".
- **No "Prepared by"** anywhere in the report.
- Lifewood branding: colours from `app/globals.css` (`--lw-castleton-green #046241`, `--lw-dark-serpent #133020`, `--lw-paper #f5eedb`, `--lw-saffaron #ffb347`, `--lw-earth-yellow #ffc370`), font Manrope (already loaded), logo `public/lifewood-logo.svg`.
- Cover line, verbatim: `Generated on [date] as part of the SEO/GEO project operations for [client brand].`
- GEO weights, verbatim: Citability 25, Brand authority 20, E-E-A-T 20, Technical GEO 15, Schema 10, Platform 10.
- Rating bands: 90–100 Excellent · 75–89 Good · 60–74 Fair · 40–59 Poor · 0–39 Critical.
- Website depth: homepage + up to 10 key pages. Competitors: top 3, homepage (+ sitemap for asset counts) only.
- Fetch rules: `isPublicHttpUrl` on every hop, manual redirects (max 3), 8 s per fetch, 1 MB per body, User-Agent `LifewoodAIVisibilityBot/1.0`.
- Snapshot ≤ 512 KB (validated server-side). One running report per project.
- Model: `OPENROUTER_MODEL` secret, default `google/gemini-2.5-flash-lite`. Every AI call is logged to `ai_usage_log`.
- Prompt limit stays 50 per project (nothing here changes prompts).
- Category naming everywhere (`category`, `p_category`) — the live DB has no "topic" columns.
- Supabase Free plan: Edge Function wall clock 150 s. The background job gets a 120 s budget; stages past the budget are skipped and noted.
- Production DB changes and deploys only with the user's explicit go-ahead.

## Review Focus

1. **Brand site blocks bots / is JS-only / times out** → website sections say "Could not be audited" with the reason; AI visibility pages still render. Test: Task 9 `audit with unreachable site still completes`.
2. **Project with no tracking data in the period** → AI visibility pages show "No tracking runs in this period"; Platform score excluded and GEO weights renormalised. Tests: Task 7 `renormalises when a category is missing`, Task 11 `empty period snapshot`.
3. **AI returns numbers not in the input** → sentences with unknown numbers are dropped. Test: Task 8 `strips sentences with unknown numbers`.
4. **Viewer or non-member calls the function / edits a report** → 403 from the function; RLS update denied and the trigger rejects non-`edits` column changes. Tests: Task 9 `rejects viewers`, Task 2 verification SQL.
5. **Function dies mid-run** → a `queued`/`running` report whose `updated_at` is older than 10 minutes shows as failed with Retry. Test: Task 12 `stale running report is failed`.

---

## File Structure

```
supabase/migrations/20261103110000_audit_reports.sql      table, trigger, RLS, usage-log actions, gaps RPC
supabase/functions/_shared/url-guard.ts (+test)            moved from prompt-assistant
supabase/functions/_shared/openrouter.ts (+test)           moved
supabase/functions/_shared/html-text.ts (+test)            moved
supabase/functions/_shared/json-extract.ts (+test)         extractJson() split out of llm-json.ts
supabase/functions/_shared/safe-fetch.ts (+test)           fetchPublic(): guarded fetch with manual redirects
supabase/functions/prompt-assistant/*                      imports switched to ../_shared
supabase/functions/site-audit/types.ts                     audit/narrative types
supabase/functions/site-audit/crawl.ts (+test)             homepage, robots, llms.txt, sitemap, key-page pick
supabase/functions/site-audit/crawlers.ts (+test)          robots.txt → per-AI-crawler allow/deny
supabase/functions/site-audit/llms-txt.ts (+test)          llms.txt presence/structure
supabase/functions/site-audit/schema.ts (+test)            JSON-LD extraction and checks
supabase/functions/site-audit/technical.ts (+test)         per-page SEO checks
supabase/functions/site-audit/citability.ts (+test)        passage scorer (port)
supabase/functions/site-audit/brand-authority.ts (+test)   Wikipedia/Wikidata, social profiles
supabase/functions/site-audit/knowledge-assets.ts (+test)  sitemap path counts
supabase/functions/site-audit/scoring.ts (+test)           category scores, GEO, SEO Health, bands
supabase/functions/site-audit/narrative.ts (+test)         prompts, parsing, number guard, fallback
supabase/functions/site-audit/index.ts                     handler, stages, persistence
lib/leaderboard.ts (+test)                                 helpers/fetchers extracted from competitors page
lib/report-types.ts                                        ReportSnapshot, Narrative, Audit, Edits types (app side)
lib/presence.ts (+test)                                    hostname → social / directory / website
lib/report-data.ts                                         gatherSnapshot()
lib/report-view.ts (+test)                                 edits merge, formatting, bands, targets, stale status
app/platform/[projectId]/reports/page.tsx                  list + generate form
app/platform/[projectId]/reports/[reportId]/page.tsx       progress + report + edit + print
components/report/*.tsx                                    one component per report page + Editable + ReportPage frame
components/project-shell.tsx                               "Reports" nav item
app/globals.css                                            print stylesheet
```

---

### Task 1: Move shared Deno helpers to `_shared/`

**Files:**
- Create: `supabase/functions/_shared/{url-guard,openrouter,html-text,json-extract,safe-fetch}.ts` and matching `*.test.ts`
- Modify: `supabase/functions/prompt-assistant/index.ts`, `llm-json.ts` (import `extractJson` from `../_shared/json-extract.ts`, re-export it so `llm-json.test.ts` still passes)
- Delete: `supabase/functions/prompt-assistant/{url-guard,openrouter,html-text}.ts` and their tests (moved with `git mv`)

**Interfaces:**
- Produces:
  - `isPublicHttpUrl(value: string): boolean`, `readTextCapped(res: Response, maxBytes: number): Promise<string>` (unchanged)
  - `callOpenRouter(messages, maxTokens, deps?)`, `type ChatMessage`, `type OpenRouterResult` (unchanged)
  - `htmlToText(html, budget?)` (unchanged)
  - `extractJson(text: string): unknown` (unchanged behaviour)
  - `fetchPublic(url: string, opts: { accept: string; maxBytes?: number; timeoutMs?: number; fetch?: typeof fetch }): Promise<FetchedPage>` where
    `type FetchedPage = { ok: true; url: string; status: number; contentType: string; headers: Headers; body: string } | { ok: false; url: string; status: number | null; reason: "unsafe_url" | "timeout" | "network" | "too_many_redirects" | "http_error" }`.
    Defaults: `maxBytes 1_000_000`, `timeoutMs 8_000`, 3 redirects, UA `LifewoodAIVisibilityBot/1.0`. `ok:false, reason:"http_error"` for status ≥ 400 (body not read).

- [ ] **Step 1:** `git mv` the three helper files and their tests into `_shared/`; fix their relative imports.
- [ ] **Step 2: Write failing tests** `_shared/json-extract.test.ts` (move the `extractJson` cases from `llm-json.test.ts`) and `_shared/safe-fetch.test.ts` with an injected `fetch`:
  - `follows a redirect and re-checks the target` — first response 301 `location: https://example.com/b`, second 200 html → `{ok:true, url:"https://example.com/b", status:200}`.
  - `rejects redirect to internal host` — 302 `location: http://localhost/` → `{ok:false, reason:"unsafe_url"}`.
  - `stops after 3 redirects` → `reason:"too_many_redirects"`.
  - `reports http errors` — 404 → `{ok:false, status:404, reason:"http_error"}`.
  - `caps the body` — 2 MB body with `maxBytes: 1000` → `body.length === 1000`.
- [ ] **Step 3:** Run `npx -y deno test supabase/functions/_shared` → FAIL (missing modules).
- [ ] **Step 4:** Implement `json-extract.ts` (move `extractJson`) and `safe-fetch.ts` (logic of `fetchHomepageText` in `prompt-assistant/index.ts`, generalised). Rewrite `fetchHomepageText` in `prompt-assistant/index.ts` as `fetchPublic(url,{accept:"text/html"})` + content-type check + `htmlToText`.
- [ ] **Step 5:** Run `npx -y deno test supabase/functions` → all pass (43 existing + new). Run `npx -y deno check supabase/functions/prompt-assistant/index.ts` → no errors. Delete generated `deno.lock`.
- [ ] **Step 6: Commit** `refactor: share fetch, OpenRouter and HTML helpers across edge functions`

---

### Task 2: Database migration

**Files:**
- Create: `supabase/migrations/20261103110000_audit_reports.sql`

**Interfaces:**
- Produces table `public.audit_reports` (columns exactly as spec §4.2), RPC `public.get_report_prompt_gaps(p_project_id uuid, p_start_date date, p_end_date date, p_tracking_location text, p_limit int default 10) returns table(prompt text, category text, competitors text[])`.

Contents (all idempotent: `if not exists`, `drop … if exists`, `create or replace`):
- [ ] **Step 1: Table.** `status text not null default 'queued' check (status in ('queued','running','completed','failed'))`, `step text`, `edits jsonb not null default '{}'`, `period_label text`, timestamps default `now()`. Index `audit_reports_project_created_idx (project_id, created_at desc)`. Partial unique index `audit_reports_one_running_idx on (project_id) where status in ('queued','running')`.
- [ ] **Step 2: RLS.** Enable RLS. `select` to authenticated using `public.is_project_member(project_id)`. `update` to authenticated using/with check `public.can_edit_project(project_id)`. No insert/delete policies. `grant select, update on public.audit_reports to authenticated; grant all on public.audit_reports to service_role;`
- [ ] **Step 3: Edits-only trigger.** `before update` trigger function `audit_reports_guard_update()`:
  ```sql
  if coalesce(auth.role(), '') = 'authenticated'
     and (to_jsonb(new) - 'edits' - 'updated_at') is distinct from (to_jsonb(old) - 'edits' - 'updated_at') then
    raise exception 'Only report edits can be changed.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
  ```
- [ ] **Step 4: Usage-log actions.** `alter table public.ai_usage_log drop constraint if exists ai_usage_log_action_check;` then add it back with `action in ('analyze','generate','audit_eeat','audit_narrative')`. Confirm the live constraint name first with a read-only query on `pg_constraint`.
- [ ] **Step 5: Gaps RPC.** `language sql stable security invoker set search_path = public`. Before writing it, confirm with read-only queries that `response_brand_evidence_scoped.entity_id` holds `brand_registry.id` and that `ai_responses.prompt_id` links to `prompts`. Logic: responses in the period/location (`metric_date` between dates, `run_id` in published runs is not required) grouped by prompt; keep prompts where no evidence row has the tracked brand (`brand_registry.is_tracked_brand`) and ≥ 1 evidence row has a `category_brand_assignments.role='competitor'` brand; return the prompt text, its category and up to 3 competitor `canonical_name`s ordered by evidence count; order by number of responses where competitors appeared desc; limit `p_limit`.
- [ ] **Step 6: Review** the file against spec §4.2 (no test runner for SQL here). Do **not** apply it — Task 16 applies it with the user's go-ahead.
- [ ] **Step 7: Commit** `feat: audit_reports table, edit guard and prompt-gap RPC`

---

### Task 3: Crawl, robots and llms.txt

**Files:**
- Create: `supabase/functions/site-audit/types.ts`, `crawl.ts`, `crawlers.ts`, `llms-txt.ts` and tests

**Interfaces:**
- Consumes: `fetchPublic` (Task 1).
- Produces:
  - `AI_CRAWLERS = ["GPTBot","OAI-SearchBot","ChatGPT-User","ClaudeBot","anthropic-ai","PerplexityBot","CCBot","Bytespider","cohere-ai","Google-Extended","GoogleOther","Applebot-Extended","FacebookBot","Amazonbot"] as const` (list from geo-seo-claude `scripts/fetch_page.py` L215-230); `KEY_CRAWLERS = ["GPTBot","OAI-SearchBot","ChatGPT-User","ClaudeBot","PerplexityBot","Google-Extended"]`.
  - `parseRobots(text: string | null): RobotsResult` — `{ exists: boolean; crawlers: Record<string, "allowed" | "blocked" | "partial">; sitemaps: string[] }`. Rule: the most specific matching `User-agent` group wins (exact name, else `*`); `Disallow: /` → blocked; other non-empty `Disallow` → partial; none → allowed. Missing file → every crawler allowed, `exists:false`.
  - `analyzeLlmsTxt(text: string | null): LlmsTxtResult` — `{ exists: boolean; hasTitle: boolean; hasSummary: boolean; sectionCount: number; linkCount: number; valid: boolean }`; valid = title (`# `) + summary (`> `) + ≥ 1 `## ` section with ≥ 1 markdown link.
  - `parseSitemap(xml: string): { urls: string[]; childSitemaps: string[] }` (`<loc>` inside `<url>` vs `<sitemap>`).
  - `pickKeyPages(homepageUrl: string, candidates: string[], max = 10): string[]` — same host only, dedupe, skip assets (`.pdf .jpg .png .xml`, query strings), prefer paths matching in this order: about, services|solutions|products, pricing, case-stud|customers|portfolio, blog|insights|resources|news, faq, contact; fill the rest with shortest paths.
  - `crawlSite(domain: string, deps?: { fetch?: typeof fetch; deadline?: number }): Promise<CrawlResult>` — `{ origin: string; reachable: boolean; error?: string; homepage: FetchedHtml | null; pages: FetchedHtml[]; robotsText: string | null; llmsText: string | null; sitemapUrls: string[] }`, `FetchedHtml = { url: string; status: number; html: string; ms: number }`. Candidates = sitemap URLs (+ one level of child sitemaps, max 3) ∪ homepage `<a href>` links. Pages fetched 4 at a time; stop starting new fetches after `deadline` (epoch ms).

- [ ] **Step 1: Write failing tests** (`crawlers.test.ts`, `llms-txt.test.ts`, `crawl.test.ts`) with fixtures inline:
  - `blocks GPTBot but allows others` — robots `User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /` → `GPTBot:"blocked"`, `ClaudeBot:"allowed"`.
  - `wildcard disallow-all blocks every crawler` → all `"blocked"`.
  - `partial disallow` — `User-agent: *\nDisallow: /private` → `"partial"`.
  - `missing robots allows all` — `parseRobots(null).exists === false`, every value `"allowed"`.
  - `collects Sitemap lines`.
  - `valid llms.txt` / `missing llms.txt` (`exists:false, valid:false`) / `llms.txt without links is invalid`.
  - `parses urlset and sitemapindex`.
  - `pickKeyPages prefers about/services/pricing and skips other hosts and assets` — candidates include `https://other.com/about`, `/logo.png`, `/about-us`, `/services`, `/blog/post-1` → starts `["…/about-us","…/services", …]`, never other host/assets, length ≤ 10.
  - `crawlSite marks unreachable homepage` — injected fetch throws → `reachable:false`, `error` set, `pages:[]`.
- [ ] **Step 2:** Run `npx -y deno test supabase/functions/site-audit` → FAIL.
- [ ] **Step 3:** Implement the four files with the signatures above.
- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5: Commit** `feat(site-audit): crawl, robots and llms.txt checks`

---

### Task 4: Schema and technical SEO checks

**Files:**
- Create: `supabase/functions/site-audit/schema.ts`, `technical.ts` and tests

**Interfaces:**
- Consumes: `FetchedHtml` (Task 3), `htmlToText` (Task 1).
- Produces:
  - `extractSchema(html: string): SchemaResult` — `{ blocks: number; invalidBlocks: number; types: string[]; sameAs: string[]; hasOrganization: boolean; hasWebSite: boolean; contentTypes: string[] }`. Parses every `<script type="application/ld+json">`, flattens `@graph` and arrays; `hasOrganization` for `Organization|LocalBusiness|Corporation|ProfessionalService` (and subtypes ending in `Business`); `contentTypes` ∩ `Article|BlogPosting|Product|Service|FAQPage|HowTo|BreadcrumbList|Review`.
  - `mergeSchema(results: SchemaResult[]): SchemaResult` (union across pages).
  - `checkPage(page: FetchedHtml): PageCheck` — `{ url; status; title: string|null; titleLength; metaDescription: string|null; metaDescriptionLength; h1Count; canonical: string|null; hasViewport: boolean; lang: string|null; wordCount; textToHtmlRatio: number; jsDependent: boolean; hasSchema: boolean }`. `jsDependent` = `htmlToText(html) === null` or word count < 50 while the HTML has a root `<div id="root|__next|app">` or > 5 `<script src>`.
  - `checkSiteWide(origin: string, homepage: PageCheck | null, robots: RobotsResult, sitemapFound: boolean): SiteChecks` — `{ https: boolean; robotsTxt: boolean; sitemap: boolean; canonical: boolean; viewport: boolean; serverRendered: boolean }`.

- [ ] **Step 1: Write failing tests:**
  - `extracts Organization with sameAs from @graph` → `hasOrganization:true`, `sameAs` length 2, `types` includes `"WebSite"`.
  - `counts invalid JSON-LD blocks` → `invalidBlocks:1`.
  - `no schema` → `blocks:0, types:[]`.
  - `checkPage reads title, meta description, h1 count, canonical, viewport, lang`.
  - `flags JS-only shell` — `<div id="root"></div>` + 6 scripts → `jsDependent:true`.
  - `checkSiteWide http origin fails https`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(site-audit): schema and technical SEO checks`

---

### Task 5: Citability scorer

**Files:**
- Create: `supabase/functions/site-audit/citability.ts` and test

**Interfaces:**
- Produces:
  - `scorePassage(text: string, heading?: string | null): PassageScore` — `{ total: number; answerBlock: number; selfContainment: number; structure: number; statistics: number; uniqueness: number }`.
  - `scorePageCitability(html: string): PageCitability` — `{ score: number; passages: number; best: { heading: string|null; text: string; score: number }[]; worst: same[] }` (best/worst: up to 3 each, text ≤ 300 chars).

- [ ] **Step 1:** Port `score_passage` and the block-splitting part of `analyze_page_citability` from `C:\Users\ANAMERAH\Documents\geo-seo-claude\scripts\citability_scorer.py` (L26-245 and L247-330) **keeping every point value, regex and threshold unchanged**. Page score = mean of passage totals, rounded; 0 passages → score 0.
- [ ] **Step 2: Write failing tests:**
  - `definition passage with a statistic scores higher than vague text` — `"Lifewood is a data annotation company founded in 2004 that serves 40% of …"` (2–3 sentences, 60–120 words) vs a 2-sentence marketing blurb with no facts → first `total` > second `total` + 15.
  - `page score averages passages`, `empty page scores 0`.
  - Plus 2 fixed-value cases computed by running the Python script on the same text (`python -I scripts/citability_scorer.py` is URL-based, so call `score_passage` via `python -I -c "import sys; sys.path.insert(0,'scripts'); from citability_scorer import score_passage; print(score_passage(open(sys.argv[1]).read()))" file.txt`) — assert identical `total`.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** `feat(site-audit): passage citability scorer ported from geo-seo-claude`

---

### Task 6: Brand authority and knowledge assets

**Files:**
- Create: `supabase/functions/site-audit/brand-authority.ts`, `knowledge-assets.ts` and tests

**Interfaces:**
- Consumes: `fetchPublic`, `SchemaResult.sameAs`.
- Produces:
  - `SOCIAL_HOSTS = { linkedin: ["linkedin.com"], youtube: ["youtube.com","youtu.be"], x: ["x.com","twitter.com"], facebook: ["facebook.com"], instagram: ["instagram.com"], tiktok: ["tiktok.com"], github: ["github.com"] }`.
  - `findSocialProfiles(homepageHtml: string, sameAs: string[]): Record<keyof typeof SOCIAL_HOSTS, string | null>` (from `sameAs` first, then `<a href>` in the page).
  - `lookupWikipedia(brand: string, deps?): Promise<{ found: boolean; title: string | null; url: string | null }>` — `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=<brand>&format=json&srlimit=3`; found only when a result title equals the brand case-insensitively or starts with `"<brand> ("`.
  - `lookupWikidata(brand: string, deps?): Promise<{ found: boolean; id: string | null }>` — `wbsearchentities&search=<brand>&language=en&format=json&limit=3`; exact label match.
  - `manualCheckLinks(brand: string): { platform: string; url: string }[]` — search URLs for Reddit, YouTube, LinkedIn, G2, Trustpilot, Crunchbase (as `brand_scanner.py` builds them).
  - `countKnowledgeAssets(urls: string[]): Record<AssetKind, number>`, `AssetKind = "blog" | "case_studies" | "whitepapers" | "guides" | "faq" | "docs" | "news"`; path patterns: blog `/blog|/insights|/articles`, case_studies `/case-stud|/customers|/success-stor`, whitepapers `/whitepaper|/white-paper|/ebook|/report`, guides `/guide|/how-to|/tutorial`, faq `/faq|/help`, docs `/docs|/documentation|/kb|/knowledge`, news `/news|/press|/media`. A URL counts once, first match wins, index pages (`/blog` itself) not counted.

- [ ] **Step 1: Write failing tests:** `finds LinkedIn from sameAs and YouTube from footer link`; `wikipedia exact title match` / `wikipedia unrelated result is not found` (injected fetch); `wikidata exact label`; `counts assets by path and skips index pages`; `manual links encode the brand`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(site-audit): brand authority and knowledge asset checks`

---

### Task 7: Scoring

**Files:**
- Create: `supabase/functions/site-audit/scoring.ts` and test

**Interfaces:**
- Consumes: results of Tasks 3–6; `snapshotSignals = { byEngine: { visibilityScore: number|null }[]; overallVisibility: number|null; thirdPartyHosts: number }` (from the snapshot).
- Produces:
  - `GEO_WEIGHTS = { citability: 25, brand: 20, eeat: 20, technical: 15, schema: 10, platform: 10 }`.
  - `rating(score: number): "Excellent" | "Good" | "Fair" | "Poor" | "Critical"` (bands in Global Constraints).
  - `technicalScore(robots, llms, siteChecks): number` — key-crawler access 40 (40 × share of `KEY_CRAWLERS` "allowed"; "partial" counts half), llms.txt 20 (exists 12 + valid 8), server-rendered 20, HTTPS 10, sitemap 10.
  - `schemaScore(s: SchemaResult): number` — Organization 35, `sameAs` ≥ 2 → 20 (1 → 10), WebSite 10, content types 5 each up to 20, no invalid blocks 15 (only when `blocks > 0`).
  - `brandScore(b): number` — Wikipedia 30, Wikidata 20, LinkedIn 10, YouTube 10, X 5, Facebook 5, Instagram 5, third-party hosts in AI answers `min(15, 1.5 × hosts)`.
  - `citabilityScore(pages: PageCitability[]): number | null` — mean of page scores; null if no pages.
  - `eeatScore(e: EeatResult | null): number | null` — sum of four 0–25 sub-scores.
  - `platformScore(signals): number | null` — mean of non-null per-engine visibility scores (clamped 0–100); null if none.
  - `geoScore(scores: Record<keyof typeof GEO_WEIGHTS, number | null>): number | null` — weighted mean over non-null categories with weights renormalised; null if all null. Rounded to integer.
  - `seoHealth(site: SiteChecks, pages: PageCheck[]): number | null` — site-wide 40 (https 10, robots 5, sitemap 10, canonical 5, viewport 5, serverRendered 5) + 60 × mean page score, page score = share of {status 200, title 30–65 chars, meta description 70–160 chars, exactly one H1, ≥ 300 words, has schema}; null when no pages.

- [ ] **Step 1: Write failing tests:**
  - `weights sum to 100`.
  - `geoScore all 100 → 100`, `geoScore mixed` — `{citability:80, brand:50, eeat:60, technical:90, schema:40, platform:30}` → `round(80*.25+50*.2+60*.2+90*.15+40*.1+30*.1)` = `63`.
  - `renormalises when a category is missing` — same with `platform:null` → `round((80*25+50*20+60*20+90*15+40*10)/90)` = `66`.
  - `rating bands at 90, 89, 75, 74, 60, 59, 40, 39`.
  - `technicalScore all crawlers blocked, no llms.txt` → `0+0+20+10+10` = `40` for an SSR https site with sitemap.
  - `schemaScore with nothing` → `0`. `seoHealth perfect site` → `100`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(site-audit): GEO, SEO Health and category scoring`

---

### Task 8: AI prompts, parsing and the number guard

**Files:**
- Create: `supabase/functions/site-audit/narrative.ts` and test

**Interfaces:**
- Consumes: `extractJson` (Task 1), `ChatMessage`.
- Produces:
  - `eeatMessages(brand: string, pages: { url: string; text: string }[]): ChatMessage[]` — ≤ 5 pages, ≤ 6,000 words total; reply shape `{"experience":{"score":0-25,"evidence":string}, "expertise":…, "authoritativeness":…, "trustworthiness":…}`.
  - `parseEeat(text: string): EeatResult` — `{ experience|expertise|authoritativeness|trustworthiness: { score: number; evidence: string } }`, scores clamped 0–25; throws `MODEL_JSON_INVALID` if any dimension is missing.
  - `narrativeMessages(input: NarrativeInput): ChatMessage[]` — input = brand, period, snapshot numbers, scores, top findings per category, competitor rows. System prompt says: client-facing, written by Lifewood, plain English, **use only numbers that appear in the input**, never write "Prepared by", say "AI visibility" not "AEO", reply JSON only in the `Narrative` shape below.
  - `parseNarrative(text: string, allowedText: string): Narrative` — shape:
    ```ts
    type PillarKey = "website" | "knowledge" | "authority" | "community" | "monitoring";
    type Narrative = {
      executiveSummary: { position: string[] };                      // 3
      kpiNotes: { visibility: string; rank: string; citations: string; shareOfVoice: string };
      competitorSummary: string;
      pillars: Record<PillarKey, { position: string[] }>;            // 3 each
      targetNotes: string;
      fallback?: true;
    };
    ```
    Missing lists become `[]`. No "How Lifewood can help" content (removed by the user).
  - `stripUnknownNumbers(text: string, allowedText: string): string` — numbers = `/\d+(?:[.,]\d+)?%?/g` normalised (drop `,` thousands separators and trailing `%`); a sentence containing a number absent from `allowedText`'s number set is removed. Years 2000–2100 are always allowed only if present in `allowedText` (no exception).
  - `fallbackNarrative(findings: Record<string, string[]>): Narrative` — findings copied into pillar `position` lists, `fallback: true`.

- [ ] **Step 1: Write failing tests:**
  - `parses a full narrative`; `fills missing lists with []`; `ignores extra keys such as initiatives`.
  - `strips sentences with unknown numbers` — allowed `"score 42.5 rank 3 of 12"`, text `"Your score is 42.5. You could reach 80 soon. Rank 3 of 12."` → `"Your score is 42.5. Rank 3 of 12."`.
  - `allows thousands separators` — allowed `"1200"`, text `"1,200 citations."` kept.
  - `parseEeat clamps to 25 and rejects missing dimension`.
  - `narrativeMessages forbid Prepared by and AEO` — system content includes `"Prepared by"` rule text and `"AI visibility"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(site-audit): E-E-A-T and narrative prompts with number guard`

---

### Task 9: `site-audit` function handler

**Files:**
- Create: `supabase/functions/site-audit/index.ts`, `index.test.ts`
- Modify: `supabase/config.toml` — add `[functions.site-audit]\nverify_jwt = false` (same as prompt-assistant; the handler validates the token itself)

**Interfaces:**
- Consumes: everything from Tasks 1, 3–8.
- Produces HTTP API:
  - `POST {action:"start", project_id, period_start, period_end, period_label, tracking_location, snapshot}` → `200 {report_id}`; `400 INVALID_REQUEST` (bad dates, snapshot missing/not an object/> 512 KB or `snapshot.version !== 1`); `401` auth errors (same codes as prompt-assistant); `403 Not authorized.`; `404 PROJECT_NOT_FOUND`; `409 REPORT_RUNNING` with message `"A report is already being generated for this project."` (unique-index violation `23505`).
  - Exported for tests: `runAudit(ctx: AuditContext, deps: AuditDeps): Promise<void>` where `AuditDeps = { fetch: typeof fetch; callAi: typeof callOpenRouter; save: (patch: Record<string, unknown>) => Promise<void>; now: () => number }`.

Behaviour:
- Auth and role check copied from `prompt-assistant/index.ts` (`profiles.role` or `project_members.role` in admin/superadmin).
- Insert row `{project_id, requested_by, period_start, period_end, period_label, tracking_location, visibility_snapshot, status:"running", step:"crawling"}` with the service-role client; reply; `EdgeRuntime.waitUntil(runAudit(...))`.
- `runAudit` stages, calling `save({step})` before each: `crawling` (crawlSite brand, deadline = start + 70 s) → `checking` (robots, llms, schema, technical, citability, knowledge assets, brand authority) → `competitors` (top 3 from `snapshot.competitors` where `!isTracked && website`, homepage + robots + llms.txt + sitemap in parallel, 8 s each; result `CompetitorCheck = { name; website; reachable; error?; aiCrawlersAllowed; aiCrawlersTotal; llmsTxt: boolean; schemaTypes: string[]; citability: number|null; knowledgeAssets: number|null }`) → `scoring_content` (E-E-A-T AI call, skipped when no page text or past 100 s) → `writing` (narrative AI call; on any AI error or past 110 s use `fallbackNarrative` and set `audit.notices` to include the user-facing message for the error code) → `saving` (final `save({status:"completed", step:"saving", audit, narrative, ai_visibility_score, geo_score, seo_score, ai_cost_usd, completed_at})`).
- Any thrown error → `save({status:"failed", error: <message>})`.
- `audit` JSON = `{ site: { origin, reachable, error?, robots, llmsTxt, siteChecks, pages: PageCheck[], citability: PageCitability[] (without passage text beyond best/worst), schema, knowledgeAssets, brandAuthority, manualCheckLinks, eeat }, scores: { citability, brand, eeat, technical, schema, platform, geo, seo }, findings: Record<"citability"|"brand"|"eeat"|"technical"|"schema"|"platform"|"seo", string[]>, competitors: CompetitorCheck[], notices: string[], budgetSkipped: string[] }`. Findings are generated deterministically from the check results (2–3 per category, e.g. `"GPTBot and ClaudeBot are blocked in robots.txt."`, `"No llms.txt file found."`, `"4 of 11 pages have no meta description."`).
- AI calls logged to `ai_usage_log` with actions `audit_eeat` / `audit_narrative`; `ai_cost_usd` = sum of `cost`.
- `ai_visibility_score` = `snapshot.overall.visibilityScore`.

- [ ] **Step 1: Write failing tests** in `index.test.ts` driving `runAudit` with fakes (fake fetch serving fixture HTML/robots/sitemap by URL; fake `callAi` returning fixed JSON; `save` pushing patches into an array):
  - `happy path saves steps in order and completes` — steps `["crawling","checking","competitors","scoring_content","writing","saving"]`, last patch `status:"completed"`, `geo_score` is a number.
  - `audit with unreachable site still completes` — brand fetch throws → `audit.site.reachable === false`, `status:"completed"`, `seo_score === null`.
  - `AI failure falls back` — `callAi` throws `AI_CREDIT_EXHAUSTED` → `narrative.fallback === true`, `audit.notices.length === 1`, `status:"completed"`.
  - `competitor failure shows unavailable` — one competitor fetch throws → that `CompetitorCheck.reachable === false`, others fine.
  - `rejects viewers` and `rejects oversized snapshot` — call the exported `handleRequest(req, deps)` with a fake auth/DB layer → 403 / 400.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (`handleRequest` exported; `Deno.serve(handleRequest)` only when `import.meta.main`). **Step 4:** Run all Deno tests → PASS; `npx -y deno check supabase/functions/site-audit/index.ts` clean; delete `deno.lock`.
- [ ] **Step 5: Commit** `feat(site-audit): background audit function`

---

### Task 10: Extract leaderboard logic

**Files:**
- Create: `lib/leaderboard.ts`, `lib/leaderboard.test.ts`
- Modify: `app/platform/[projectId]/competitors/page.tsx` — import the moved code; no behaviour change

**Interfaces:**
- Produces (moved verbatim from `competitors/page.tsx` L59-116 and the fetchers inside its effect L158-250):
  - `hostFromUrl`, `rootWebsite`, `numberValue`, `aggregateCompetitorRows`, `aggregateOwnRow`, `competitorsObservedInPeriod`, `rankBrands` (same signatures).
  - `loadLeaderboard(client: SupabaseClient, args: { projectId: string; category: string /* "Overall" for all */; engines: string[]; start: string; end: string; location: string; brandName: string; brandDomains: string[] }): Promise<{ rows: LeaderboardRow[] /* ranked, tracked brand key "__tracked_brand__" */; activeCompetitors: number; totalCompetitors: number }>` — the registry/published-runs/observations/own-metrics pipeline currently inside the page effect, including the tracked-brand exclusion and published-run filter.

- [ ] **Step 1: Write failing tests** for the pure helpers: `rankBrands sorts by score, then citations, then name`; `aggregateCompetitorRows ignores observations without a matching own-metric scope`; `competitorsObservedInPeriod drops brands with no matched observations`.
- [ ] **Step 2:** `node --test lib/leaderboard.test.ts` → FAIL. **Step 3:** Move the code; the page calls `loadLeaderboard` for the current and previous ranges. **Step 4:** Tests PASS; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5:** Run the app, open Leaderboards for one project, compare ranks/scores with production for the same period → identical.
- [ ] **Step 6: Commit** `refactor: share leaderboard loading between Leaderboards and reports`

---

### Task 11: Snapshot types, presence classification and `gatherSnapshot`

**Files:**
- Create: `lib/report-types.ts`, `lib/presence.ts`, `lib/presence.test.ts`, `lib/report-data.ts`, `lib/report-data.test.ts`

**Interfaces:**
- Consumes: `loadLeaderboard` (Task 10), `latestSnapshots`, `rankDisplay` (`lib/rank-snapshot.ts`), `reportingDateRange` (`lib/reporting-date.ts`), RPCs `get_cumulative_citations`, `get_third_party_mentions`, `get_report_prompt_gaps` (Task 2).
- Produces:
  ```ts
  // lib/report-types.ts
  export type Presence = { social: number; directories: number; websites: number };
  export type BenchmarkRow = { name: string; website: string | null; isTracked: boolean; rank: number | null;
    visibilityScore: number | null; shareOfVoice: number | null; citations: number; presence: Presence };
  export type ReportSnapshot = {
    version: 1;
    brand: { name: string; website: string | null; categories: string[] };
    period: { start: string; end: string; label: string };
    location: string; engines: string[]; promptCount: number; hasData: boolean;
    overall: { visibilityScore: number | null; scoreChange: number | null; rank: number | null;
      population: number | null; rankText: string; shareOfVoice: number | null; brandCitations: number };
    trend: { date: string; score: number | null }[];
    byEngine: { engine: string; label: string; visibilityScore: number | null }[];
    byCategory: { category: string; visibilityScore: number | null; rank: number | null; rankText: string }[];
    competitors: BenchmarkRow[];            // tracked brand first, then top 3 by rank
    gaps: { prompt: string; category: string; competitors: string[] }[];   // ≤ 10
    topCitedPages: { url: string; frequency: number; isBrand: boolean }[]; // ≤ 10
    topCitedDomains: { hostname: string; responses: number }[];            // ≤ 10
    brandSiteCited: boolean; thirdPartyHosts: number;
  };
  // also the app-side mirrors of Narrative, Audit (Task 9 JSON), ReportEdits, AuditReportRow
  export type ReportEdits = { text?: Record<string, string>; manual?: { domainAuthority?: Record<string, string> };
    targets?: { scope: string; targetScore: number | null; targetRank: number | null }[] };
  ```
  - `classifyHost(hostname: string): keyof Presence` — social: linkedin, facebook, x, twitter, instagram, youtube, tiktok, reddit, quora, medium, pinterest; directories: g2, capterra, clutch, trustpilot, yelp, crunchbase, glassdoor, goodfirms, sortlist, yellowpages, getapp, softwareadvice, tripadvisor, gartner; everything else websites (incl. news). Subdomains match (`uk.linkedin.com` → social).
  - `gatherSnapshot(client: SupabaseClient, projectId: string, period: { label: string; start: string; end: string }): Promise<ReportSnapshot>`:
    - project: `brand_name, brand_domains, brand_terms, categories, tracking_market`; location = `tracking_market ?? "MY"`.
    - overall/byCategory/trend: dashboard query (`visibility_daily`, `llm_provider="Overall"`, location, dates) + `latestSnapshots` + `rankDisplay`; trend = rows with `category="Overall"`.
    - byEngine + shareOfVoice: analytics query (`neq llm_provider "Overall"`), per engine latest `category="Overall"` row; `overall.shareOfVoice` = mean of the latest per-engine `share_of_voice_score` (non-null).
    - engines: distinct `llm_provider` values in that query; promptCount: `prompts` count for the project.
    - competitors: `loadLeaderboard({category:"Overall", engines})`; tracked row + first 3 competitors; benchmark `shareOfVoice` = brand score ÷ Σ scores of all ranked rows × 100 (1 dp).
    - presence per brand: `third_party_mentions` (`hostname, associated_brand_ids`, project/location/dates, paged by 1000) — brand-owned hosts excluded the way `get_third_party_mentions` does; count distinct hostnames per brand id per `classifyHost` class. Tracked brand id from `brand_registry.is_tracked_brand`.
    - citations: `get_cumulative_citations` with `p_category:null, p_engines:[]` — `brand_related_only:true` sum of `frequency` → `overall.brandCitations`, `brandSiteCited` = any brand-related URL on a `brand_domains` host; `brand_related_only:false` top 10 → `topCitedPages` (`isBrand` by host). Benchmark `citations` from the leaderboard rows.
    - topCitedDomains: `get_third_party_mentions` (`p_category:null, p_engines:[]`) top 10 by `response_frequency`; `thirdPartyHosts` = row count.
    - gaps: `get_report_prompt_gaps(…, 10)`.
    - `hasData` = any `visibility_daily` row in the period.
  - `periodFromChoice(choice: "Last 7 Days" | "Last 30 Days" | "Last 90 Days" | "Custom", customStart?: string, customEnd?: string): { label; start; end }` — uses `reportingDateRange` (clamped end).

- [ ] **Step 1: Write failing tests:** `presence.test.ts` — `linkedin subdomain is social`, `g2 is a directory`, `news site is a website`; `report-data.test.ts` — `periodFromChoice Last 30 Days` with fixed `today`; `benchmark share of voice sums to 100`; `empty period snapshot` — a fake client returning no rows → `hasData:false`, `overall.visibilityScore:null`, `competitors` has only the tracked row. Make the fake client a small chainable stub in the test file.
- [ ] **Step 2:** `node --test lib/presence.test.ts lib/report-data.test.ts` → FAIL. **Step 3:** Implement. **Step 4:** PASS; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5: Commit** `feat: gather the AI visibility snapshot for reports`

---

### Task 12: Report view helpers

**Files:**
- Create: `lib/report-view.ts`, `lib/report-view.test.ts`

**Interfaces:**
- Consumes: types from Task 11.
- Produces:
  - `rating(score: number | null): { label: string; tone: "good" | "fair" | "poor" } ` — same bands; null → `{label:"Not measured", tone:"fair"}`. Tone: Excellent/Good → good, Fair → fair, Poor/Critical → poor.
  - `textFor(narrative: Narrative | null, edits: ReportEdits, path: string): string` — `edits.text[path]` if set, else the value at the dotted `path` (e.g. `"pillars.website.position.1"`), else `""`.
  - `setText(edits: ReportEdits, path: string, value: string | null): ReportEdits` — `null` removes the override (Reset to generated). Pure.
  - `suggestedTargets(snapshot: ReportSnapshot): { scope: string; currentScore: number|null; targetScore: number|null; currentRank: number|null; targetRank: number|null }[]` — Overall + up to 3 categories (lowest score first); target score = `min(100, round1(current + max(5, current × 0.25)))`; target rank = `max(1, current − 2)`; nulls stay null.
  - `targetsFor(snapshot, edits)` — suggested merged with `edits.targets` by `scope`.
  - `effectiveStatus(row: { status: string; updated_at: string }, now = Date.now()): "queued" | "running" | "completed" | "failed"` — queued/running with `updated_at` older than 10 min → `"failed"`.
  - `fmtScore(n: number | null, dp = 1): string` (`"—"` for null), `fmtPercent`, `fmtDate(iso: string): string` (`"3 November 2026"`, `en-GB`).
  - `STEP_LABELS: Record<string, string>` — crawling "Crawling the website", checking "Running SEO and GEO checks", competitors "Checking competitors", scoring_content "Scoring content quality (E-E-A-T)", writing "Writing the report", saving "Saving".

- [ ] **Step 1: Write failing tests:** `edit overrides generated text`, `setText null resets`, `path into pillar lists`, `suggestedTargets overall 40 → 50 and rank 5 → 3`, `suggestedTargets low score uses +5` (10 → 15), `targetsFor applies edits by scope`, `stale running report is failed` (updated 11 min ago) / `fresh running stays running`, `rating null`, `fmtDate`.
- [ ] **Step 2:** `node --test lib/report-view.test.ts` → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: report view helpers (edits, targets, status, formatting)`

---

### Task 13: Reports list page, generate form and navigation

**Files:**
- Create: `app/platform/[projectId]/reports/page.tsx`
- Modify: `components/project-shell.tsx` — add `["Reports", "/reports", FileText]` after `["Samples", …]` in `baseNav` (import `FileText` from lucide-react)

**Interfaces:**
- Consumes: `periodFromChoice`, `gatherSnapshot` (Task 11), `effectiveStatus`, `rating`, `fmtScore`, `fmtDate` (Task 12), function API (Task 9).

Behaviour:
- Role: load `profiles.role` and `project_members.role` the way `dashboard/page.tsx` L276-295 does; `canGenerate` for admin/superadmin.
- List: `audit_reports` `select id, created_at, period_label, period_start, period_end, status, step, updated_at, ai_visibility_score, geo_score, seo_score, error` for the project, newest first. Each row: date, period, three score chips with `rating()` tone, status from `effectiveStatus`; links to `/platform/{id}/reports/{reportId}`. Empty state: "No reports yet."
- Form (admins only): period select (Last 7 / 30 / 90 Days, Custom with two date inputs, default Last 30 Days); location shown read-only from `tracking_market`; button **Generate report**. On click: busy text "Gathering AI visibility data…" → `gatherSnapshot` → `supabase.functions.invoke("site-audit", { body: { action: "start", project_id, period_start, period_end, period_label, tracking_location, snapshot } })` → `router.push` to the report page. Errors shown with the function's `message` (409 shows "A report is already being generated for this project.").
- Page title "Reports", subtitle "Client-ready AI visibility, GEO and SEO audit reports." Reuse existing `platform-*` classes from other pages.

- [ ] **Step 1:** Implement the page and nav item.
- [ ] **Step 2:** `npx tsc --noEmit -p .` clean; `npm run lint` clean for the new files.
- [ ] **Step 3:** In the running app (after Task 16 deploy, or against a stubbed function), check: viewer sees list without form; admin sees form; Reports tab highlights on `/reports` and `/reports/<id>`.
- [ ] **Step 4: Commit** `feat: reports list and generate form`

---

### Task 13b: SVG chart components

**Files:**
- Create: `lib/chart-geometry.ts`, `lib/chart-geometry.test.ts`, `components/report/charts/{score-gauge,bar-chart,grouped-bar-chart,stacked-bar-chart,donut-chart,line-chart,sparkline,status-grid}.tsx`

**Interfaces:**
- Produces (pure, tested):
  - `linearScale(domain: [number, number], range: [number, number]): (v: number) => number`
  - `niceMax(values: (number | null)[], floor = 1): number` — smallest of 1, 2, 2.5, 5, 10 × 10ⁿ ≥ max; 100 when all values are percentages ≤ 100 and `percent` flag set → signature `niceMax(values, { percent?: boolean })`.
  - `arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string` — SVG `A` path, 0° = 12 o'clock, clockwise.
  - `donutSlices(values: { label: string; value: number }[]): { label: string; value: number; start: number; end: number; pct: number }[]` — degrees, zero-sum → `[]`.
  - `linePath(points: { x: number; y: number | null }[]): string` — gaps on null (new `M`).
- Produces (components, all SVG with `viewBox`, `role="img"`, `aria-label`, a `<title>`, value labels on marks, and a text fallback "No data for this period" when every value is null/empty):
  - `ScoreGauge({ label, score: number | null, max = 100 })` — 240° arc, tone colour from `rating()` (good `#046241`, fair `#ffb347`, poor `#a13f35`), number in the centre, rating label under it.
  - `BarChart({ title, items: { label; value: number | null; highlight?: boolean }[], format?: "number" | "percent", horizontal = true })` — highlight bar (tracked brand) in `#046241`, others `#9fb8a8`.
  - `GroupedBarChart({ title, groups: string[], series: { name; color; values: (number | null)[] }[] })` with legend.
  - `StackedBarChart({ title, items: { label; parts: { name; value; color }[] }[] })` with legend.
  - `DonutChart({ title, items: { label; value; highlight? }[] })` — centre shows the highlighted share.
  - `LineChart({ title, points: { date: string; value: number | null }[], format })` — date labels thinned to ≤ 8.
  - `Sparkline({ points })` — no axes.
  - `StatusGrid({ title, rows: { label; status: "allowed" | "partial" | "blocked" }[] })` — coloured dot + word (never colour alone).
  - Colours only from the Lifewood palette in Global Constraints plus `#9fb8a8` (muted green) and `#a13f35` (danger, already in `globals.css`).

- [ ] **Step 1: Write failing tests** `lib/chart-geometry.test.ts`: `linearScale maps ends`; `niceMax 37 → 40`, `niceMax 0.8 → 1`, `niceMax percent → 100`; `arcPath 0→90 ends at 3 o'clock` (for cx=cy=50, r=40 path ends with `90 50`); `donutSlices pct sums to 100 and zero-sum gives []`; `linePath breaks at null` (two `M`).
- [ ] **Step 2:** `node --test lib/chart-geometry.test.ts` → FAIL. **Step 3:** Implement geometry, then the components (use the `dataviz` skill's guidance for labels, contrast and legends). **Step 4:** Tests PASS; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5: Commit** `feat: SVG chart components for reports`

---

### Task 14: Report page and report components

**Files:**
- Create: `app/platform/[projectId]/reports/[reportId]/page.tsx`, `components/report/report-page.tsx` (16:9 frame with client initial/logo + Lifewood logo + page number), `components/report/editable.tsx`, and one component per page: `cover.tsx`, `executive-summary.tsx`, `competitor-benchmark.tsx`, `ai-visibility-detail.tsx`, `geo-audit.tsx`, `seo-audit.tsx`, `current-position.tsx`, `initial-targets.tsx`, `methodology.tsx`, `thank-you.tsx`

**Interfaces:**
- Consumes: `AuditReportRow` and types (Task 11), all of Task 12, chart components (Task 13b).
- Produces: `<Editable path={string} value={string} canEdit={boolean} onSave={(path, value | null) => void} multiline? />` — click to edit, Save/Cancel, **Reset to generated** when an override exists. `ReportPage({ number, title?, brand, children })`.

Behaviour:
- Load the row; while `effectiveStatus` is queued/running poll every 3 s and show the checklist from `STEP_LABELS` (done ✓ / current spinner / pending). Failed: error message + **Retry** (admins) which regathers the snapshot with the same period and starts a new report.
- Completed: toolbar (Back to reports · **Download PDF** → `window.print()`), then the 11 pages in spec §3 order (Cover, 1.0, 2.0, 2.1 charts, 3.0, 4.0, 5.0, 6.0, 7.0 targets, Methodology, Thank you) with spec §3 content. Specifics:
  - Cover: brand name, "AI Visibility & GEO Audit Report", period (`fmtDate` start – end), location label (`trackingLocationLabel`), the Global-Constraints cover line with `fmtDate(created_at)`. No "Prepared by".
  - Executive summary: 4 KPI tiles (visibility score, rank `rankText` "of N", website citations, share of voice) with `kpiNotes`; three `ScoreGauge`s (AI Visibility / GEO Score / SEO Health) with `rating`; visibility `Sparkline`; 1.1 bullets via `Editable`. No 1.2.
  - Competitor benchmark: rows 2.1–2.7 × brand + 3 competitors; 2.5 from `audit.site.knowledgeAssets` (sum) and `CompetitorCheck.knowledgeAssets`; 2.6 `presence` "news & websites · directories · social"; 2.7 domain authority from `edits.manual.domainAuthority[name]` (admins edit, default "—"); GEO quick checks rows from audit; `competitorSummary`; "Unavailable" for unreachable competitors.
  - AI visibility detail: `LineChart` trend, `BarChart` by engine, `BarChart` by category, gaps table, top cited pages/domains, "Your website is / is not cited by AI answers". `hasData:false` → "No tracking runs in this period. Run tracking from the Dashboard, then generate a new report."
  - GEO audit: `ScoreGauge` + `BarChart` of six categories (label shows weight) + `StatusGrid` of AI crawlers + findings; manual-check links.
  - SEO audit: `ScoreGauge`, site-wide checks list, `BarChart` of pass rate per page check, per-page table (title, meta description, H1, words, schema, status).
  - 2.1 Competitor charts (own page): `BarChart` visibility score, `DonutChart` share of voice, `BarChart` citations, `GroupedBarChart` knowledge assets, `StackedBarChart` external presence.
  - Section 6.0: five pillars with titles "Website content & structure", "Knowledge assets & resources", "Branding & authority", "Community engagement", "Monitoring & research".
  - **No "How Lifewood Can Help" page** (removed by the user).
  - Initial targets (7.0): `targetsFor` table + `GroupedBarChart` current vs target; admins edit target cells (save into `edits.targets`).
  - Methodology: score formulas (weights, SEO Health composition), engines tracked, prompt count, period/location, which checks are verified vs "check manually" (domain authority, manual-check links), `audit.notices` and `audit.budgetSkipped`.
  - Website not reachable → sections 4.0/5.0 show "Could not be audited: {reason}".
- Saving edits: `supabase.from("audit_reports").update({ edits }).eq("id", reportId)`; optimistic update; error banner on failure.

- [ ] **Step 1:** Implement the components and page.
- [ ] **Step 2:** `npx tsc --noEmit -p .` and `npm run lint` clean.
- [ ] **Step 3:** Visual check happens in Task 16 Step 4 on a real report (no fixture routes in shipped code).

> **Spec deviations (agreed in planning):** migration is `20261103110000_audit_reports.sql` (later than the rename and assistant migrations); external presence (2.6) groups hosts as social · directories · websites & news, because the data has no news/directory/social labels — classification is by hostname list in `lib/presence.ts`.
- [ ] **Step 4: Commit** `feat: report page with editable, branded sections`

---

### Task 15: Print stylesheet (PDF)

**Files:**
- Modify: `app/globals.css`, `components/report/report-page.tsx`, `components/project-shell.tsx` (add `print:hidden` to header/nav)

- [ ] **Step 1:** Add:
  ```css
  @media print {
    @page { size: 297mm 167mm; margin: 0; }
    html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-toolbar, .platform-shell-chrome { display: none !important; }
    .report-page { width: 297mm; height: 167mm; break-after: page; overflow: hidden; box-shadow: none; margin: 0; }
  }
  ```
  On screen `.report-page` keeps `aspect-ratio: 16 / 9` and scales with width.
- [ ] **Step 2:** Print-preview a completed report in Chrome (Save as PDF): 11 pages, one report page per sheet, backgrounds on, no app chrome, no clipped tables (long per-page SEO tables cap at 11 rows, which the crawl limit already guarantees).
- [ ] **Step 3: Commit** `feat: 16:9 print layout for report PDF`

---

### Task 16: Deploy and end-to-end check (needs the user's go-ahead)

- [ ] **Step 1:** Full test run: `node --test lib/*.test.ts`, `npx -y deno test supabase/functions`, `npx tsc --noEmit -p .` → all pass; delete `deno.lock`, `next-env.d.ts` changes.
- [ ] **Step 2:** Ask the user to approve: apply `20261103110000_audit_reports.sql`, deploy `site-audit`, redeploy `prompt-assistant` (shared-file move). Then run them (`npx -y supabase db query --remote --yes -f …`, `npx -y supabase functions deploy site-audit --use-api --yes`, same for `prompt-assistant`).
- [ ] **Step 3:** Verify with read-only SQL: table, indexes, policies, trigger and RPC exist; `select * from get_report_prompt_gaps(<MDLand or a tracked project>, …)` returns rows or empty without error.
- [ ] **Step 4:** In the app as an admin: generate a report for a project with tracking data; watch the checklist; confirm completion < 2 min; check every page; edit one text block and reset it; edit a target; download PDF. As a viewer: open the report, no edit controls.
- [ ] **Step 5:** Commit any fixes; push the branch and open a PR to `main` only if the user asks.
