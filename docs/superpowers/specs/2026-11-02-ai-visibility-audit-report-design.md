# AI Visibility & GEO Audit Report — Design

Date: 2026-11-02 · Branch: `feat/audit-report` (from `feat/ai-prompt-assistant`) · Status: approved in conversation, spec awaiting review

## 1. Goal

Admins generate a professional, client-facing report for a brand project from the platform. The report leads with
the brand's **AI visibility** (the platform's tracking data) and supports it with a **GEO audit** and an **SEO audit**
of the brand's website, a **competitor benchmark**, and a plan for **how Lifewood can help**. It is reviewed and
edited in the app, then downloaded as a Lifewood-branded PDF.

Terminology: "AEO" means AI visibility. Reports and UI say "AI visibility".

Out of scope: shareable client links, scheduled/automatic reports, month-to-month comparison view (reports are saved,
so this can follow later), paid SEO data APIs.

## 2. Decisions (from the conversation)

| Topic | Decision |
|---|---|
| Delivery | In-app report page + PDF download. Past reports are saved per project. |
| Build approach | A — background audit job in a Supabase Edge Function with a live progress checklist. |
| Website depth | Homepage + up to 10 key pages from the sitemap. |
| Competitors | Top 3 tracked competitors: platform AI visibility data + homepage-only GEO check. |
| Scoring | Deterministic checks ported from the geo-seo-claude skill (MIT); AI only for E-E-A-T scoring and narrative. |
| Branding | Lifewood brand (colours, Manrope, logo). **No "Prepared by"** anywhere. |
| Who | Admins/superadmins generate and edit; every project member can view and download. |
| Prompt limit | Unchanged: 50 per project. |
| Reference | `Client Introduction Report Template.pptx` (7 slides, 16:9). The report follows its structure and adds the audit sections. |

## 3. Report structure

Pages are **16:9 landscape**, matching the template. Every page has the client logo/initial and the Lifewood logo.

| # | Page | Content | Source |
|---|---|---|---|
| 1 | Cover | `[Client brand]` · "AI Visibility & GEO Audit Report" · reporting period · "Generated on [date] as part of the SEO/GEO project operations for [client brand]." | project |
| 2 | 1.0 Executive Summary | 4 KPI tiles: Overall visibility score, Overall rank (of N), Website citations in AI, Share of voice — each with a one-line note. **Charts:** three score gauges (AI Visibility, GEO Score, SEO Health) and a visibility-score sparkline. 1.1 The brand's current position (3 bullets). | tracking + audit + AI |
| 3 | 2.0 Competitor Benchmark | Table: brand vs top 3 competitors — 2.1 visibility rank, 2.2 visibility score, 2.3 share of voice, 2.4 citations, 2.5 knowledge assets, 2.6 external presence (social · directories · websites & news), 2.7 domain authority, plus GEO quick checks (AI crawler access, llms.txt, schema, citability). One-line summary. | tracking + audit + manual |
| 4 | 2.1 Competitor Charts | **Charts:** visibility score bars (brand vs top 3), share-of-voice donut, citations bars, knowledge assets grouped bars, external presence stacked bars. | tracking + audit |
| 5 | 3.0 AI Visibility in Detail | **Charts:** visibility score trend line, bars by AI engine, bars by category. Tables: prompts where the brand is absent but competitors appear (top 10 gaps); top cited domains/pages and whether the brand's own site is cited. | tracking |
| 6 | 4.0 GEO Audit | GEO Score gauge and **bar chart** of the six category scores with the skill's weights (Citability 25, Brand authority 20, E-E-A-T 20, Technical GEO 15, Schema 10, Platform 10); **AI crawler access grid** (allowed / partial / blocked); 2–3 evidence-backed findings per category. | audit |
| 7 | 5.0 SEO Audit | SEO Health gauge; site-wide checks (HTTPS, robots.txt, sitemap, canonical, mobile viewport, JS-dependent content); **pass-rate bars** per page check across crawled pages; per-page table (title, meta description, H1, word count, schema, status). | audit |
| 8 | 6.0 The Brand's Current Position | Five pillars from the template, 3 points each: Website content & structure, Knowledge assets & resources, Branding & authority, Community engagement, Monitoring & research. | AI from findings |
| 9 | 7.0 Initial Targets | Overall + up to 3 categories: visibility score and rank, current vs target, with a **current-vs-target bar chart**. Targets are suggested and editable. | tracking + editable |
| 10 | Methodology | How each score is calculated, engines and prompt count tracked, period and location, which checks are verified vs "check manually". | static + report data |
| 11 | Thank you | Closing page. | static |

**Removed at the user's request (2026-11-05):** "How Lifewood Can Help" (page and the executive-summary bullets).

**Charts** are hand-built SVG components (the app has no chart library; `components/metric-chart.tsx` is SVG too), so
they print sharply to PDF. Lifewood palette; every chart has a title, labelled values and a text fallback when data is
missing.

Where the template asks for data the platform cannot measure (domain authority), the field is **manual**: shown as
"—" with an edit control for admins, and noted in the methodology.

## 4. Architecture

```
Reports page ──(1) gather AI visibility snapshot in the browser (existing queries)──┐
     │                                                                              │
     └──(2) POST site-audit {action:"start", projectId, period, location, snapshot} ┘
                    │  auth check · one running report per project · insert audit_reports row
                    │  reply {reportId} immediately, continue with EdgeRuntime.waitUntil
                    ▼
            crawl brand site → checks → competitor homepages → AI calls → scores → save
                    │  updates audit_reports.step after every stage
Report page ◄── polls audit_reports every 3 s until completed/failed
```

### 4.1 Why the AI visibility snapshot is gathered in the browser

The dashboard, competitors and citations pages already compute visibility score, rank, share of voice, citations and
third-party mentions with tested queries and RPCs (`visibility_daily`, `get_cumulative_citations`,
`get_third_party_mentions`, `get_published_run_ids_for_leaderboard`, `lib/page-reports.ts`). The report reuses that
code instead of re-implementing metric logic in Deno, so **report numbers always match the app**. The loaders are
extracted into `lib/report-data.ts` and shared by the pages and the report.

### 4.2 Database (migration `20261102100000_audit_reports.sql`)

`public.audit_reports`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| project_id | uuid fk → projects, on delete cascade | |
| requested_by | uuid fk → auth.users | |
| period_start, period_end | date | |
| tracking_location | text | |
| status | text | `queued` · `running` · `completed` · `failed` |
| step | text | current stage key for the checklist |
| visibility_snapshot | jsonb | from the browser, validated server-side for shape and size (≤ 512 KB) |
| audit | jsonb | crawl results, check results, category scores |
| narrative | jsonb | AI-written text blocks |
| edits | jsonb default '{}' | admin overrides for text blocks, manual fields and targets |
| ai_visibility_score, geo_score, seo_score | numeric | headline scores for the list view |
| ai_cost_usd | numeric | |
| error | text | |
| created_at, updated_at, completed_at | timestamptz | |

RLS: project members `select`; admins/superadmins `update` **only** the `edits` column (enforced by a `before update`
trigger that rejects changes to other columns from the `authenticated` role); inserts and other updates only through
the service role in the function. A partial unique index on `(project_id) where status in ('queued','running')`
enforces one running report per project.

### 4.3 Edge function `supabase/functions/site-audit/`

Reuses from `prompt-assistant`: auth/role check, `url-guard.ts` (`isPublicHttpUrl`, `readTextCapped`, manual
redirects), `openrouter.ts`, `html-text.ts`, `ai_usage_log`. Shared files move to `supabase/functions/_shared/`.

Files, each with one job and its own tests:

| File | Job | Ported from |
|---|---|---|
| `crawl.ts` | Fetch homepage, robots.txt, llms.txt, sitemap.xml (+ index); pick ≤ 10 key pages (about, services/products, pricing, blog, case studies, FAQ, contact) | `fetch_page.py` |
| `crawlers.ts` | Parse robots.txt; allow/deny per AI crawler (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended, Bingbot, CCBot, …) | `fetch_page.py`, geo-crawlers |
| `llms-txt.ts` | Presence and structure of llms.txt | `llmstxt_generator.py`, geo-llmstxt |
| `schema.ts` | Extract JSON-LD; types found, required-field completeness, `sameAs` profiles | geo-schema |
| `technical.ts` | Per-page SEO checks: status, HTTPS, title, meta description, H1, canonical, viewport, lang, word count, text-to-HTML ratio, JS-dependent content | geo-technical |
| `citability.ts` | Split content into passages; score answer-block quality, self-containment, readability, statistic density, uniqueness | `citability_scorer.py` |
| `brand-authority.ts` | Wikipedia + Wikidata APIs; `sameAs`/footer social profiles; manual-check links for Reddit, YouTube, LinkedIn, G2, Trustpilot, Crunchbase | `brand_scanner.py` |
| `knowledge-assets.ts` | Count resource pages from the sitemap by path (blog, case studies, whitepapers, guides, FAQ, docs, news) | new (template 2.5) |
| `scoring.ts` | Category scores, GEO Score (skill weights), SEO Health, AI Visibility headline, rating bands | geo-audit |
| `narrative.ts` | Build the two prompts; parse AI JSON (reuses `llm-json.ts` helpers) | new |
| `index.ts` | Request handling, stages, progress updates, persistence | new |

Stages (`step` values): `crawling` → `checking` → `competitors` → `scoring_content` → `writing` → `saving`.

AI calls (OpenRouter, `google/gemini-2.5-flash-lite`):
1. **E-E-A-T** — input: extracted text of up to 5 crawled pages (≤ 6,000 words total) → JSON scores for experience,
   expertise, authoritativeness, trustworthiness with one evidence quote each.
2. **Narrative** — input: the measured findings and snapshot numbers only → JSON for executive summary bullets,
   KPI notes, five-pillar current position, competitor summary, target notes.
   The prompt forbids numbers that are not in the input; numbers in the output are checked against the input and
   any unknown number is removed.

External presence (template 2.6) comes from `get_third_party_mentions` source types in the snapshot
(news · directories/websites · social). Citations (2.4) come from the snapshot.

### 4.4 App

- `components/project-shell.tsx`: add **Reports** to the project navigation.
- `app/platform/[projectId]/reports/page.tsx`: list of saved reports (date, period, three headline scores, status)
  and the **Generate report** form (period: Last 7/30/90 days or custom; location from project settings).
  Admins only see the form.
- `app/platform/[projectId]/reports/[reportId]/page.tsx`: progress checklist while running; the report when done.
  Admins can click any text block, manual field or target to edit; saving writes `edits`. **Reset to generated**
  per block.
- `components/report/*`: one component per report page, shared by the screen and print views; `components/report/charts/*`: SVG gauge, bar, grouped/stacked bar, donut, line and status-grid charts.
- `lib/report-data.ts`: snapshot loaders shared with the existing pages. `lib/report-view.ts`: merge `narrative` +
  `edits`, format numbers, rating bands (with tests).
- **Download PDF**: print stylesheet (`@page { size: 297mm 167mm }` ≈ 16:9, one report page per printed page,
  backgrounds on, app chrome hidden) and `window.print()`. Manrope is already loaded by the app.

## 5. Error handling

| Situation | Behaviour |
|---|---|
| Brand site unreachable / blocks bots | Website sections say "Could not be audited" with the reason; AI visibility sections still complete. |
| A competitor homepage fails | That column shows "Unavailable"; report continues. |
| AI call fails or credit is exhausted | Scores are saved; narrative falls back to a plain list of findings; notice on the report. Messages reuse `assistantErrorMessage`. |
| No tracking data in the period | AI visibility pages say "No tracking runs in this period" and suggest running tracking. |
| Function dies mid-run | A report `running` for more than 10 minutes is shown as failed with **Retry** (creates a new report with the same settings). |
| Second report while one runs | Rejected with "A report is already being generated for this project." |
| Unsafe URL / SSRF | Same `url-guard` rules as the prompt assistant; 1 MB per page; 8 s per fetch; 3 redirects. |

## 6. Testing

- Deno unit tests per check file on fixture HTML / robots.txt / sitemap / JSON-LD: blocked vs allowed crawlers,
  missing llms.txt, invalid schema, good vs poor citability passages, knowledge-asset path counts.
- `scoring.ts`: weights, missing categories, rating bands.
- `narrative.ts`: JSON parsing, unknown-number stripping.
- `lib/report-view.ts` node tests: edit merging, formatting.
- Manual end-to-end run on one project after deploy; print to PDF and check page breaks.

## 7. Cost and limits

About 1–2 minutes and $0.01–0.02 per report. Edge Function background work stays within Supabase's wall-clock
limit because each stage is short and progress is saved after each stage.

## 8. Deployment (needs a Supabase project owner)

1. `supabase db push` (adds `audit_reports`).
2. `supabase functions deploy site-audit`.
3. Reuses the `OPENROUTER_API_KEY` secret from the prompt assistant.

Note: the live database already uses category naming (`projects.categories`, main #91). This branch includes that change.
