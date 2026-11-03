-- AI prompt assistant: cached brand profile per project and a usage log for OpenRouter spend.

alter table public.projects
  add column if not exists brand_profile jsonb,
  add column if not exists brand_profile_updated_at timestamptz;

create table if not exists public.ai_usage_log (
  id bigint generated always as identity primary key,
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid,
  action text not null check (action in ('analyze', 'generate')),
  model text not null,
  prompt_tokens integer,
  completion_tokens integer,
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_log_project_created_idx
  on public.ai_usage_log (project_id, created_at desc);

alter table public.ai_usage_log enable row level security;

drop policy if exists "Superadmins read AI usage" on public.ai_usage_log;
create policy "Superadmins read AI usage" on public.ai_usage_log
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'superadmin'
  ));

grant select, insert on public.ai_usage_log to service_role;
