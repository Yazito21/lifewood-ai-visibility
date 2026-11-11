
-- Standalone client-facing report drafts, kept separate from the legacy site-audit reports.
create table if not exists public.client_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  report_type text not null check (report_type in (
    'monthly', 'simple', 'introductory', 'technical_audit', 'competitor_comparison'
  )),
  period_start date not null,
  period_end date not null,
  period_label text,
  tracking_location text not null,
  snapshot jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_reports_valid_period check (period_end >= period_start)
);

create index if not exists client_reports_project_created_idx
  on public.client_reports (project_id, created_at desc);

alter table public.client_reports enable row level security;

drop policy if exists "client reports visible to project members" on public.client_reports;
create policy "client reports visible to project members"
  on public.client_reports for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists "client reports created by project editors" on public.client_reports;
create policy "client reports created by project editors"
  on public.client_reports for insert to authenticated
  with check (
    public.can_edit_project(project_id)
    and (created_by is null or created_by = auth.uid())
  );

drop policy if exists "client reports editable by project editors" on public.client_reports;
create policy "client reports editable by project editors"
  on public.client_reports for update to authenticated
  using (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists "client reports deletable by project editors" on public.client_reports;
create policy "client reports deletable by project editors"
  on public.client_reports for delete to authenticated
  using (public.can_edit_project(project_id));

grant select, insert, update, delete on public.client_reports to authenticated;
grant all on public.client_reports to service_role;

create or replace function public.client_reports_touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists client_reports_touch_updated_at on public.client_reports;
create trigger client_reports_touch_updated_at
  before update on public.client_reports
  for each row execute function public.client_reports_touch_updated_at();
