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
