# Lifewood AI Visibility

A standalone platform for tracking a brand's visibility, share of voice, rankings, citations, and competitors across AI answer engines.

## Product boundary

This repository is intentionally separate from the `lifewood-aeo-geo` operations platform.

The AI visibility platform is responsible for:

- Brand/project configuration
- Exactly 100 tracked prompts per project
- LLM/API configuration
- Raw AI response retention
- Daily visibility metrics
- Citations and competitor extraction
- Project-scoped user access and analytics

## Current implementation

Stage 1 — Supabase database foundation deployed.

Stage 2 — authentication/project-selection foundation implemented in Next.js.

Stage 3 — login, password recovery, project selection, project creation, project deletion safeguards, and project shell implemented.

The intended tracking pipeline is:

`100 prompts × 5 AI answer engines → raw responses → extraction → daily metrics → analytics`

## Supabase

Project ref: `jhauufmrxpsbfrahgclv`

URL: `https://jhauufmrxpsbfrahgclv.supabase.co`

Authentication is handled by Supabase Auth. Passwords must never be displayed or stored by the application in plaintext.

The database trigger provisions `aiman@lifewood.com` as a permanent Superadmin profile automatically when that Auth user is created.

Because the connected development tooling does not expose Supabase Auth's admin user-creation endpoint, the initial Auth user must be created once in Supabase Dashboard → Authentication → Users. The profile trigger then assigns the Superadmin role automatically.

## Vercel

The Vercel project is connected to this GitHub repository and uses the Supabase project above.

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Metric integrity

Visibility score, rank, population and citation counts follow one definition per metric
(`public.metric_definitions`, mirrored in `lib/metric-definitions.ts` and shown by the info icons in the UI).

- **One rank implementation:** `public.canonical_scoped_rank` (Postgres). It compares exact
  presence/response fractions; ties share a rank; the population is the tracked brand plus competitors with
  valid observations for the same run/topic/date/engine/location. The dashboard cards, charts and leaderboard
  read the stored result and never recompute it (`lib/rank-snapshot.ts`).
- **Publication gate:** a run is published by setting `tracking_runs.published_at`. A trigger supersedes the
  previous run for the same scope/day, recomputes the tracked score from raw evidence (the update fails if it
  disagrees with the stored score) and stamps counts, rank and population.
- **Overall:** pooled responses of the latest published topic runs of the day (`publish_overall_metrics`),
  recorded as an `overall_aggregate` run. It is not an average of topic scores.
- **Checks:** run `select * from public.check_metric_integrity();` or execute
  `supabase/tests/metric_integrity_contract.sql` after migrations. Any `error` row means a metric must not be trusted.
