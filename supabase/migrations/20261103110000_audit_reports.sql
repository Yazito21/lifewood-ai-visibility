-- AI visibility & GEO audit reports.
-- Rows are written by the site-audit Edge Function (service role). Project members read them;
-- project editors may change only the `edits` column (enforced by a trigger).

create table if not exists public.audit_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  period_start date not null,
  period_end date not null,
  period_label text,
  tracking_location text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  step text,
  visibility_snapshot jsonb,
  audit jsonb,
  narrative jsonb,
  edits jsonb not null default '{}'::jsonb,
  ai_visibility_score numeric,
  geo_score numeric,
  seo_score numeric,
  ai_cost_usd numeric(12, 6),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists audit_reports_project_created_idx
  on public.audit_reports (project_id, created_at desc);

-- One report in progress per project.
create unique index if not exists audit_reports_one_running_idx
  on public.audit_reports (project_id) where status in ('queued', 'running');

alter table public.audit_reports enable row level security;

drop policy if exists "audit reports visible to members" on public.audit_reports;
create policy "audit reports visible to members" on public.audit_reports
  for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists "audit reports edits by editors" on public.audit_reports;
create policy "audit reports edits by editors" on public.audit_reports
  for update to authenticated
  using (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

grant select, update on public.audit_reports to authenticated;
grant all on public.audit_reports to service_role;

create or replace function public.audit_reports_guard_update()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and (to_jsonb(new) - 'edits' - 'updated_at') is distinct from (to_jsonb(old) - 'edits' - 'updated_at') then
    raise exception 'Only report edits can be changed.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists audit_reports_guard_update on public.audit_reports;
create trigger audit_reports_guard_update
  before update on public.audit_reports
  for each row execute function public.audit_reports_guard_update();

-- AI usage from the audit is logged alongside the prompt assistant's.
alter table public.ai_usage_log drop constraint if exists ai_usage_log_action_check;
alter table public.ai_usage_log add constraint ai_usage_log_action_check
  check (action in ('analyze', 'generate', 'audit_eeat', 'audit_narrative'));

-- Prompts where competitors appear in AI answers but the tracked brand does not.
-- Imported responses often have no prompt_id, so prompts are grouped by their text.
create or replace function public.get_report_prompt_gaps(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_tracking_location text,
  p_limit integer default 10
)
returns table (prompt text, category text, competitors text[])
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with responses as (
    select r.id,
           coalesce(p.prompt, r.prompt_snapshot) as prompt_text,
           p.category as prompt_category
    from ai_responses r
    left join prompts p on p.id = r.prompt_id
    where r.project_id = p_project_id
      and r.response_status = 'completed'
      and r.tracking_location = p_tracking_location
      and (timezone('Asia/Kuala_Lumpur', r.captured_at))::date between p_start_date and p_end_date
      and coalesce(p.prompt, r.prompt_snapshot) is not null
  ),
  tracked as (
    select id from brand_registry where project_id = p_project_id and is_tracked_brand
  ),
  competitor_ids as (
    select distinct brand_id from category_brand_assignments
    where project_id = p_project_id and role = 'competitor'
  ),
  evidence as (
    select resp.prompt_text, resp.prompt_category, e.category as evidence_category, e.response_id, e.brand_id,
           (e.brand_id in (select id from tracked)) as is_tracked,
           (e.brand_id in (select brand_id from competitor_ids)) as is_competitor
    from responses resp
    join response_brand_evidence e on e.response_id = resp.id and e.project_id = p_project_id
  ),
  prompt_stats as (
    select prompt_text,
           coalesce(max(prompt_category), max(evidence_category)) as category,
           bool_or(is_tracked) as brand_seen,
           count(distinct response_id) filter (where is_competitor) as competitor_responses
    from evidence
    group by prompt_text
  ),
  competitor_counts as (
    select ev.prompt_text, b.canonical_name, count(*) as n
    from evidence ev
    join brand_registry b on b.id = ev.brand_id
    where ev.is_competitor
    group by ev.prompt_text, b.canonical_name
  )
  select s.prompt_text as prompt,
         s.category,
         (select array_agg(c.canonical_name order by c.n desc, c.canonical_name)
            from (select * from competitor_counts cc where cc.prompt_text = s.prompt_text
                  order by cc.n desc, cc.canonical_name limit 3) c) as competitors
  from prompt_stats s
  where not s.brand_seen and s.competitor_responses > 0
  order by s.competitor_responses desc, s.prompt_text
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$function$;

grant execute on function public.get_report_prompt_gaps(uuid, date, date, text, integer) to authenticated;
