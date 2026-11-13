-- Candidate staging for atomic rerun replacement.
-- This migration is intentionally additive: it does not alter or delete published rows.
-- Apply only after the Edge Function has been updated to stage all candidate writes.

create table if not exists public.tracking_run_candidate_rows (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.tracking_runs(id) on delete cascade,
  table_key text not null check (table_key in (
    'citations',
    'citation_occurrences',
    'response_brand_evidence',
    'third_party_mentions',
    'category_brand_observations',
    'visibility_daily',
    'competitors',
    'direct_competitor_observations'
  )),
  row_key text not null,
  row_data jsonb not null check (jsonb_typeof(row_data) = 'object'),
  created_at timestamptz not null default now(),
  unique (run_id, table_key, row_key)
);

create index if not exists tracking_run_candidate_rows_run_table_idx
  on public.tracking_run_candidate_rows (run_id, table_key);

alter table public.tracking_run_candidate_rows enable row level security;

revoke all on public.tracking_run_candidate_rows from public, anon, authenticated;
grant all on public.tracking_run_candidate_rows to service_role;

create or replace function public.stage_tracking_candidate_rows(
  p_run_id uuid,
  p_table_key text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.tracking_runs%rowtype;
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if p_table_key not in (
    'citations',
    'citation_occurrences',
    'response_brand_evidence',
    'third_party_mentions',
    'category_brand_observations',
    'visibility_daily',
    'competitors',
    'direct_competitor_observations'
  ) then
    raise exception 'unsupported_candidate_table';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'candidate_rows_must_be_json_array';
  end if;

  select * into v_run
  from public.tracking_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'tracking_run_not_found';
  end if;

  if v_run.status not in ('pending', 'running') or v_run.published_at is not null then
    raise exception 'candidate_run_not_writable';
  end if;

  -- Reject cross-project/category rows before they enter the candidate staging area.
  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    where (item ? 'project_id' and nullif(item->>'project_id', '')::uuid is distinct from v_run.project_id)
       or (v_run.category is not null and item ? 'category'
           and nullif(item->>'category', '') is distinct from v_run.category)
  ) then
    raise exception 'candidate_row_scope_mismatch';
  end if;

  insert into public.tracking_run_candidate_rows(run_id, table_key, row_key, row_data)
  select
    p_run_id,
    p_table_key,
    coalesce(item->>'_candidate_key', md5((item - '_candidate_key')::text)),
    item - '_candidate_key'
  from jsonb_array_elements(p_rows) item
  on conflict (run_id, table_key, row_key)
  do update set row_data = excluded.row_data;

  -- Return the number of rows in this submitted batch (including idempotent updates).
  get diagnostics v_count = row_count;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.stage_tracking_candidate_rows(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.stage_tracking_candidate_rows(uuid, text, jsonb) to service_role;

comment on table public.tracking_run_candidate_rows is
  'Isolated, unpublished derived rows for a tracking run. Promotion into canonical date-grain tables must occur transactionally.';
