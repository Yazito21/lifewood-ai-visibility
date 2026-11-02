# AI Prompt Assistant — Design

Date: 2026-10-30
Status: Approved in conversation; awaiting written-spec review

## Goal

When a project is created (and any time afterwards), an AI analyses the brand and suggests tracked prompts
in batches of 5. The user reviews, edits and picks which ones to save. Nothing is saved without approval,
because changing the prompt set later breaks trend comparability.

Success criteria:

- A new project can go from "created" to a reviewed prompt set without writing prompts by hand.
- Each generate call is cheap (≈ $0.0003) and the OpenRouter key never reaches the browser or git.
- Default prompts do not inflate the visibility score.

## Decisions

| Topic | Decision |
|---|---|
| Save behaviour | Draft suggestions; the user selects and saves. |
| Batch size | 5 suggestions per **Generate** click; repeat until the desired count (project cap is 50). |
| Prompt type | **Discovery** (unbranded buyer questions) by default. **Brand perception** (names the brand) is an opt-in toggle and those prompts are labelled, because branded prompts mention the brand almost every time and inflate the score. |
| Model | `google/gemini-2.5-flash-lite` via OpenRouter ($0.10 in / $0.40 out per 1M tokens). Configurable with `OPENROUTER_MODEL`; fallback suggestion `deepseek/deepseek-v4-flash`. |
| Secrets | `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are Supabase Edge Function secrets. Never in the repo, `.env.local` or client code. |

## Architecture

### Two-step generation (analyse once, generate cheaply)

1. **Analyse** (once per project, refreshable): the server fetches the brand's primary website homepage,
   strips it to plain text (≤ 4,000 characters) and sends it with the brand name, description, topics and
   tracking location. The model returns a structured **brand profile**:
   `{ summary, offerings[], audiences[], markets[], differentiators[] }`. It is stored on the project.
2. **Generate**: each call sends only the stored profile, the chosen topic, the mode (discovery | brand),
   the language, the tracking location and the existing prompts of that topic (for de-duplication).
   The model returns 5 prompts. Nothing is written to `prompts`.

### Edge function `prompt-assistant`

Same structure as the existing functions (CORS, `json()` helper, bearer-token user lookup as in
`llm-key-management`).

- `POST { action: "analyze", projectId }` → `{ profile, source: "website" | "description_only", updatedAt }`
- `POST { action: "generate", projectId, topic, mode, language, count?: 1..5 }` → `{ suggestions: [{ prompt, topic, language, mode }] }`
  - `count: 1` is used by the per-card ↻ (replace one suggestion).
- Authorisation: caller must be a superadmin or a project `admin`/`superadmin` member. Viewers get 403.
- If no profile exists when `generate` is called, the function runs `analyze` first.
- Server-side de-duplication: suggestions matching an existing prompt (case/whitespace/punctuation-insensitive)
  are dropped; if fewer than requested remain, the function makes at most one top-up call.

Pure helpers live in separate files with Deno tests, following `visibility-tracking/*.ts`:

- `html-text.ts` — HTML → readable text, trimmed to a character budget.
- `llm-json.ts` — parse and validate the model's JSON (profile and suggestions).
- `prompt-dedupe.ts` — normalisation and de-duplication.

### Database (one migration)

- `projects.brand_profile jsonb null`, `projects.brand_profile_updated_at timestamptz null`.
- `ai_usage_log (id, project_id, user_id, action, model, prompt_tokens, completion_tokens, cost_usd, created_at)`
  with RLS enabled; written by the service role only, readable by superadmins. Used to watch spend against
  the OpenRouter budget.

### Frontend

- **Project creation** (`app/home/page.tsx`): unchanged inputs; after success it routes to
  `/platform/{id}/prompts?assistant=1`.
- **Prompts page** (`app/platform/[projectId]/prompts/page.tsx`):
  - "AI prompt assistant" button (editors only); opens automatically with `?assistant=1`.
  - Empty state (0 prompts) points to the assistant.
- **Assistant panel** (new component `components/prompt-assistant-panel.tsx`):
  - Brand profile card (analyses automatically on first open; **Refresh profile** button; notice when built
    from description only).
  - Topic picker, language picker (default English), Discovery / Brand perception toggle.
  - **Generate 5** → suggestion cards with checkbox, inline edit, ↻ replace, and a "Brand" badge for
    brand-perception prompts.
  - **Add selected (n)** saves through the page's existing prompt insert path; counter shows `n / 50` and
    selection is capped by the remaining slots.

## Error handling

| Situation | Behaviour |
|---|---|
| Website unreachable / blocked / non-HTML | Profile built from name + description; panel shows a notice. |
| OpenRouter 402 / credit exhausted | "AI credit has run out — top up OpenRouter or ask an admin." Existing suggestions stay on screen. |
| OpenRouter 429 / 5xx / timeout | One retry, then a retryable error message. |
| Malformed JSON from the model | One retry, then a retryable error message. |
| Missing `OPENROUTER_API_KEY` | `AI_NOT_CONFIGURED` with an admin-facing message. |

## Testing

- Deno unit tests for `html-text.ts`, `llm-json.ts`, `prompt-dedupe.ts`.
- `next build` and `tsc --noEmit` for the frontend.
- Live check after the secret is set: analyse + generate on a test project, confirm usage rows are logged.

## Out of scope

- The client-facing AI visibility report (designed separately).
- Automatic saving of prompts or automatic topic creation.
- A spend dashboard UI (the log table is enough for now; OpenRouter's dashboard also shows spend).
