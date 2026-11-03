# AI Prompt Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let editors generate reviewed tracked prompts, 5 at a time, from an AI brand profile.

**Architecture:** A new Supabase Edge Function `prompt-assistant` (Deno) analyses the brand once (homepage text → brand profile stored on `projects`) and generates prompt suggestions through OpenRouter. A new React panel on the Prompts page shows the profile, generates suggestions and saves the selected ones through the existing `prompts` insert. Pure logic lives in small tested modules.

**Tech Stack:** Next.js 16 / React 19 / Tailwind 4, Supabase (Postgres, Edge Functions on Deno), OpenRouter chat completions API.

**Spec:** `docs/superpowers/specs/2026-10-30-ai-prompt-assistant-design.md`

## Global Constraints

- Model from secret `OPENROUTER_MODEL`, default `google/gemini-2.5-flash-lite`; key from secret `OPENROUTER_API_KEY`. Neither appears in the repo, `.env.local` or client code.
- OpenRouter endpoint: `POST https://openrouter.ai/api/v1/chat/completions` with `response_format: { type: "json_object" }`, `temperature: 0.7`, `max_tokens`: 600 (analyze) / 500 (generate). Send `usage: { include: true }` to receive `usage.cost`.
- Batch size: 5 per Generate; `count` accepted range 1–5. Project prompt cap stays 100.
- Modes: `"discovery"` (default; must not name the tracked brand) and `"brand"` (names the brand; labelled "Brand" in the UI).
- Homepage text budget: 4,000 characters. Website fetch timeout: 8 s. OpenRouter timeout: 30 s.
- Authorisation identical to `llm-key-management`: platform role `superadmin`/`admin` or project member role `superadmin`/`admin`.
- Edge function style: CORS headers + `json()` helper as in `supabase/functions/llm-key-management/index.ts`; `verify_jwt = false` in `supabase/config.toml` with in-function auth (same as `llm-key-management`).
- Deno tests run with `npx -y deno test supabase/functions/prompt-assistant/`.

## Review Focus

1. Discovery prompt that still contains the brand name or a brand domain → dropped server-side, not returned (test in Task 2).
2. Model returns JSON wrapped in ```json fences or with extra prose → still parsed (test in Task 2).
3. Remaining slots < 5 (e.g. 98 prompts) → the panel lets the user select at most the remaining slots and the insert never exceeds 100 (Task 5, manual check step).
4. Homepage that is a JS-only shell (almost no text) → treated as unreachable; profile built from description with notice (test in Task 1: text under 200 chars returns `null`).
5. Viewer opens `?assistant=1` → no panel and no function call (Task 5, manual check step).

---

### Task 1: HTML → text helper

**Files:**
- Create: `supabase/functions/prompt-assistant/html-text.ts`
- Test: `supabase/functions/prompt-assistant/html-text.test.ts`

**Interfaces:**
- Produces: `htmlToText(html: string, budget?: number): string | null` — strips `<script>`, `<style>`, `<noscript>`, `<svg>`, tags and entities (`&amp; &lt; &gt; &quot; &#39; &nbsp;`), collapses whitespace, keeps `<title>` and `meta[name=description]` content first, truncates to `budget` (default 4000). Returns `null` when the result is shorter than 200 characters.

- [ ] **Step 1: Write failing tests** (`Deno.test` + `assertEquals` from `https://deno.land/std@0.224.0/assert/mod.ts`):
  - `"strips scripts and tags"`: input with `<script>alert(1)</script><p>Hello&nbsp;&amp; world</p>` plus 250 chars of body text → output contains `"Hello & world"`, not `"alert"`.
  - `"title and meta description come first"`: `<title>Acme</title><meta name="description" content="Data partner">` + long body → output starts with `"Acme. Data partner."`.
  - `"truncates to budget"`: 10,000-char body, budget 4000 → `length <= 4000`.
  - `"returns null for near-empty shells"`: `<div id="root"></div><script src="x.js"></script>` → `null`.
- [ ] **Step 2:** Run `npx -y deno test supabase/functions/prompt-assistant/html-text.test.ts` — expect FAIL (module not found).
- [ ] **Step 3:** Implement `htmlToText` with regex passes (no DOM dependency).
- [ ] **Step 4:** Re-run — expect PASS.
- [ ] **Step 5:** Commit `feat(prompt-assistant): add html-to-text helper`.

### Task 2: Model JSON parsing and prompt de-duplication

**Files:**
- Create: `supabase/functions/prompt-assistant/llm-json.ts`, `supabase/functions/prompt-assistant/prompt-dedupe.ts`
- Test: `supabase/functions/prompt-assistant/llm-json.test.ts`, `supabase/functions/prompt-assistant/prompt-dedupe.test.ts`

**Interfaces:**
- Produces:
  - `type BrandProfile = { summary: string; offerings: string[]; audiences: string[]; markets: string[]; differentiators: string[] }`
  - `extractJson(text: string): unknown` — parses raw JSON, or the first ```json fenced block, or the substring from the first `{` to the last `}`; throws `Error("MODEL_JSON_INVALID")` otherwise.
  - `parseProfile(text: string): BrandProfile` — requires non-empty `summary` (string); array fields default to `[]`, keep only non-empty strings, max 8 items each; throws `MODEL_JSON_INVALID`.
  - `parseSuggestions(text: string): string[]` — accepts `{ "prompts": string[] }`; trims, drops empty and > 300-char items; throws `MODEL_JSON_INVALID` when `prompts` is missing.
  - `normalisePrompt(text: string): string` — lowercase, strip punctuation, collapse whitespace.
  - `filterSuggestions(candidates: string[], existing: string[], opts: { mode: "discovery" | "brand"; brandTerms: string[]; limit: number }): string[]` — drops duplicates (vs `existing` and within `candidates`, by `normalisePrompt`); in `discovery` mode drops any candidate whose normalised text contains a normalised brand term (brand name, aliases, domains without TLD); returns at most `limit`.

- [ ] **Step 1: Write failing tests:**
  - `extractJson`: plain JSON; fenced ```` ```json {"a":1} ``` ```` → `{a:1}`; `"Sure! {\"a\":1} hope this helps"` → `{a:1}`; `"no json"` throws `MODEL_JSON_INVALID`.
  - `parseProfile`: missing `summary` throws; `offerings: ["a", "", 3]` → `["a"]`.
  - `parseSuggestions`: `{"prompts":[" best x? ", ""]}` → `["best x?"]`.
  - `filterSuggestions`: existing `["Best data annotation companies?"]`, candidate `"best data annotation companies"` → removed; discovery mode with brandTerms `["Lifewood","lifewood.com"]` drops `"Is Lifewood good?"` and keeps it in brand mode; limit 2 of 4 → length 2.
- [ ] **Step 2:** Run `npx -y deno test supabase/functions/prompt-assistant/` — expect FAIL.
- [ ] **Step 3:** Implement both modules.
- [ ] **Step 4:** Re-run — expect PASS (Task 1 tests still pass).
- [ ] **Step 5:** Commit `feat(prompt-assistant): parse model JSON and de-duplicate suggestions`.

### Task 3: Database migration

**Files:**
- Create: `supabase/migrations/20261103090000_ai_prompt_assistant.sql`

**Interfaces:**
- Produces: `projects.brand_profile jsonb`, `projects.brand_profile_updated_at timestamptz`, table `public.ai_usage_log`.

- [ ] **Step 1:** Write the migration:
  - `alter table public.projects add column if not exists brand_profile jsonb, add column if not exists brand_profile_updated_at timestamptz;`
  - `create table if not exists public.ai_usage_log (id bigint generated always as identity primary key, project_id uuid references public.projects(id) on delete cascade, user_id uuid, action text not null check (action in ('analyze','generate')), model text not null, prompt_tokens integer, completion_tokens integer, cost_usd numeric(12,6), created_at timestamptz not null default now());`
  - index on `(project_id, created_at desc)`; `enable row level security`; select policy for superadmins using the same predicate other superadmin-only policies use (`exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'superadmin')`); `grant select, insert on public.ai_usage_log to service_role`.
- [ ] **Step 2:** Verify syntax by reading it against an existing migration (e.g. `20261029110000_profound_third_party_mentions.sql`) for grant/RLS style. It is applied in the deploy step (Task 6), not locally.
- [ ] **Step 3:** Commit `feat(prompt-assistant): add brand profile columns and AI usage log`.

### Task 4: `prompt-assistant` Edge Function

**Files:**
- Create: `supabase/functions/prompt-assistant/index.ts`, `supabase/functions/prompt-assistant/openrouter.ts`
- Modify: `supabase/config.toml` (add `[functions.prompt-assistant]` `verify_jwt = false`)

**Interfaces:**
- Consumes: `htmlToText` (Task 1); `parseProfile`, `parseSuggestions`, `filterSuggestions`, `BrandProfile` (Task 2); columns from Task 3.
- Produces (HTTP, used by Task 5):
  - `POST { action: "analyze", project_id }` → `200 { profile: BrandProfile, source: "website" | "description_only", updated_at: string }`
  - `POST { action: "generate", project_id, topic, mode, language, count? }` → `200 { suggestions: { prompt: string; topic: string; language: string; mode: "discovery" | "brand" }[], profile_source? }`
  - Errors: `{ error: CODE, message }` with codes `AUTHORIZATION_TOKEN_MISSING` 401, `Not authorized.` 403, `INVALID_REQUEST` 400, `AI_NOT_CONFIGURED` 500, `AI_CREDIT_EXHAUSTED` 402, `AI_UNAVAILABLE` 502, `MODEL_JSON_INVALID` 502.
  - `openrouter.ts`: `callOpenRouter(messages: {role:"system"|"user";content:string}[], maxTokens: number): Promise<{ text: string; model: string; promptTokens: number; completionTokens: number; cost: number | null }>` — retries once on 429/5xx/timeout; maps 402 to `Error("AI_CREDIT_EXHAUSTED")`, missing key to `Error("AI_NOT_CONFIGURED")`, other failures to `Error("AI_UNAVAILABLE")`. Sends headers `HTTP-Referer: https://lifewood-ai-visibility.vercel.app` and `X-Title: Lifewood AI Visibility`.

- [ ] **Step 1:** Implement `openrouter.ts` per the interface and Global Constraints.
- [ ] **Step 2:** Implement `index.ts`:
  - Copy the CORS/`json`/`getConfiguredKey`/user-validation/authorisation block from `llm-key-management` (body field `project_id`).
  - Load project `brand_name, brand_description, brand_domains, brand_terms, topics, tracking_locations, brand_profile`.
  - `analyze`: fetch `https://` + first `brand_domains` entry (8 s timeout, `User-Agent: LifewoodAIVisibilityBot/1.0`), `htmlToText`; system prompt asks for the BrandProfile JSON only; user content = name, description, topics, location, homepage text (or "Website text unavailable"). `parseProfile`; on `MODEL_JSON_INVALID` retry once. Store profile + timestamp; log usage row.
  - `generate`: validate `topic ∈ project.topics`, `mode ∈ {discovery, brand}`, `count` 1–5 (default 5). Run analyze first if `brand_profile` is null. Load existing prompts of the project. System prompt: write `count + 3` realistic questions a buyer in `{location}` would type into an AI assistant about `{topic}`, in `{language}`; discovery = never mention the brand, its domains or aliases; brand = each question names `{brand_name}`; vary intent (comparison, recommendation, how-to, cost, trust); return `{"prompts": [...]}`. Include the profile JSON and up to 50 existing prompts for this topic as "do not repeat". `filterSuggestions(..., limit: count)`; if fewer than `count`, one top-up call. Log usage per call.
- [ ] **Step 3:** Run `npx -y deno check supabase/functions/prompt-assistant/index.ts` — expect no type errors; run `npx -y deno test supabase/functions/prompt-assistant/` — expect PASS.
- [ ] **Step 4:** Commit `feat(prompt-assistant): add edge function for brand analysis and prompt generation`.

### Task 5: Assistant panel and Prompts page integration

**Files:**
- Create: `components/prompt-assistant-panel.tsx`
- Modify: `app/platform/[projectId]/prompts/page.tsx`, `app/home/page.tsx` (redirect after create)

**Interfaces:**
- Consumes: HTTP contract from Task 4 via `supabase.functions.invoke("prompt-assistant", { body })`.
- Produces: `<PromptAssistantPanel projectId topics existingCount onClose onSave />` where `onSave(rows: { prompt: string; topic: string; language: string }[]): Promise<void>` is provided by the page.

- [ ] **Step 1:** Prompts page: extract the insert in `addPrompt` into `insertPrompts(rows)` (numbering from max `prompt_number` + 1, cap check `prompts.length + rows.length <= 100`), reuse it from `addPrompt` and pass it as `onSave`. Add an "AI prompt assistant" button (Sparkles icon, editors only) beside "Add prompt"; open the panel when `useSearchParams().get("assistant") === "1"` and `canEdit`; empty state (0 prompts) gets a call-to-action that opens the panel.
- [ ] **Step 2:** Panel (right-side drawer on desktop, full-screen sheet on mobile; reuse `platform-card`, `platform-btn`, `platform-input` classes):
  - Brand profile card: auto-`analyze` on first open when no profile is loaded (read `projects.brand_profile` client-side first); skeleton while loading; summary + offering chips; "Built from description only — website couldn't be read" notice when `source === "description_only"`; **Refresh profile** button.
  - Controls: topic select (project topics), language select (same list as the page), segmented toggle **Discovery** | **Brand perception** with helper text "Brand prompts name your brand and raise the score; use them to check how AI describes you."
  - **Generate 5**: appends suggestion cards (newest batch on top), each with checkbox (default checked), editable textarea, ↻ (calls generate with `count: 1` and replaces that card), "Brand" badge in brand mode.
  - Footer: `{existingCount + selected} / 100`; **Add selected (n)** disabled when n = 0 or would exceed remaining slots (message "Only {remaining} slots left"); after save, saved cards are removed and a success notice shows.
  - Error mapping: `AI_CREDIT_EXHAUSTED` → "AI credit has run out — top up OpenRouter or ask an admin."; `AI_NOT_CONFIGURED` → "The AI assistant isn't set up yet. An admin needs to add the OpenRouter key."; others → "The AI didn't respond. Try again." Suggestions on screen are kept on error.
- [ ] **Step 3:** `app/home/page.tsx`: change `router.push("/platform/"+project.id)` after create to `router.push("/platform/"+project.id+"/prompts?assistant=1")`.
- [ ] **Step 4:** Run `npx tsc --noEmit -p .` and `npx next build` — expect success.
- [ ] **Step 5:** Manual checks on `npm run dev`: panel opens from button and from `?assistant=1`; a viewer account sees neither; with 98 prompts only 2 can be added.
- [ ] **Step 6:** Commit `feat(prompt-assistant): add assistant panel to the Prompts page`.

### Task 6: Deploy and live verification

**Files:** none (operational).

- [ ] **Step 1:** User sets secrets: `supabase secrets set OPENROUTER_API_KEY=… OPENROUTER_MODEL=google/gemini-2.5-flash-lite --project-ref jhauufmrxpsbfrahgclv`.
- [ ] **Step 2:** Apply migration `20261103090000_ai_prompt_assistant.sql` and deploy: `supabase db push` (or apply via dashboard) and `supabase functions deploy prompt-assistant visibility-tracking --project-ref jhauufmrxpsbfrahgclv` (visibility-tracking carries the earlier brand-list change).
- [ ] **Step 3:** On a test project: Refresh profile → profile shows; Generate 5 (discovery) → 5 prompts without the brand name; toggle Brand → prompts name the brand; Add selected → rows appear in the table. Confirm `ai_usage_log` rows exist with non-null tokens.
