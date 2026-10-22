create table if not exists public.tracking_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  topic_order jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tracking_batches_project_created_idx
  on public.tracking_batches(project_id, created_at desc);
create table if not exists public.tracking_batch_topics (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.tracking_batches(id) on delete cascade,
  topic text not null,
  ordinal integer not null check (ordinal >= 0),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','skipped')),
  tracking_run_id uuid references public.tracking_runs(id) on delete set null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  unique(batch_id, topic),
  unique(batch_id, ordinal)
);
create index if not exists tracking_batch_topics_batch_status_idx
  on public.tracking_batch_topics(batch_id, status, ordinal);
alter table public.tracking_batches enable row level security;
alter table public.tracking_batch_topics enable row level security;
revoke all on public.tracking_batches, public.tracking_batch_topics from anon;
grant select, insert, update on public.tracking_batches to authenticated;
grant select, insert, update on public.tracking_batch_topics to authenticated;
grant all on public.tracking_batches, public.tracking_batch_topics to service_role;

create policy "Project admins can read tracking batches"
on public.tracking_batches for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  or exists (select 1 from public.project_members pm where pm.project_id = tracking_batches.project_id and pm.user_id = auth.uid() and pm.role in ('admin','superadmin'))
);
create policy "Project admins can create tracking batches"
on public.tracking_batches for insert to authenticated
with check (
  requested_by = auth.uid() and
  (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','superadmin'))
   or exists (select 1 from public.project_members pm where pm.project_id = tracking_batches.project_id and pm.user_id = auth.uid() and pm.role in ('admin','superadmin')))
);
create policy "Project admins can update tracking batches"
on public.tracking_batches for update to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  or exists (select 1 from public.project_members pm where pm.project_id = tracking_batches.project_id and pm.user_id = auth.uid() and pm.role in ('admin','superadmin'))
)
with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  or exists (select 1 from public.project_members pm where pm.project_id = tracking_batches.project_id and pm.user_id = auth.uid() and pm.role in ('admin','superadmin'))
);
create policy "Project admins can read batch topics"
on public.tracking_batch_topics for select to authenticated
using (exists (select 1 from public.tracking_batches b where b.id = tracking_batch_topics.batch_id));
create policy "Project admins can insert batch topics"
on public.tracking_batch_topics for insert to authenticated
with check (exists (select 1 from public.tracking_batches b where b.id = tracking_batch_topics.batch_id and (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  or exists (select 1 from public.project_members pm where pm.project_id = b.project_id and pm.user_id = auth.uid() and pm.role in ('admin','superadmin'))
)));
create policy "Project admins can update batch topics"
on public.tracking_batch_topics for update to authenticated
using (exists (select 1 from public.tracking_batches b where b.id = tracking_batch_topics.batch_id and (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  or exists (select 1 from public.project_members pm where pm.project_id = b.project_id and pm.user_id = auth.uid() and pm.role in ('admin','superadmin'))
)))
with check (exists (select 1 from public.tracking_batches b where b.id = tracking_batch_topics.batch_id and (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  or exists (select 1 from public.project_members pm where pm.project_id = b.project_id and pm.user_id = auth.uid() and pm.role in ('admin','superadmin'))
)));
