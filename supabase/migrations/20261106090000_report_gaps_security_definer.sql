-- Faster prompt-gap lookup for audit reports.
-- SECURITY DEFINER avoids a per-row RLS membership check on every joined table (the pattern used by
-- 20261020250000_secure_aggregate_rpcs_to_reduce_rls_timeouts.sql), paired with an explicit
-- authenticated project-membership check. The date filter uses a captured_at range (index friendly)
-- instead of casting each row's timestamp.

create or replace function public.get_report_prompt_gaps(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_tracking_location text,
  p_limit integer default 10
)
returns table (prompt text, category text, competitors text[])
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then
    raise exception 'Not authorized to access this project' using errcode = '42501';
  end if;

  return query
  with responses as (
    select r.id,
           coalesce(p.prompt, r.prompt_snapshot) as prompt_text,
           p.category as prompt_category
    from public.ai_responses r
    left join public.prompts p on p.id = r.prompt_id
    where r.project_id = p_project_id
      and r.response_status = 'completed'
      and r.tracking_location = p_tracking_location
      and r.captured_at >= (p_start_date::timestamp at time zone 'Asia/Kuala_Lumpur')
      and r.captured_at < ((p_end_date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
      and coalesce(p.prompt, r.prompt_snapshot) is not null
  ),
  tracked as (
    select b.id from public.brand_registry b where b.project_id = p_project_id and b.is_tracked_brand
  ),
  competitor_ids as (
    select distinct a.brand_id from public.category_brand_assignments a
    where a.project_id = p_project_id and a.role = 'competitor'
  ),
  evidence as (
    select resp.prompt_text, resp.prompt_category, e.category as evidence_category, e.response_id, e.brand_id,
           (e.brand_id in (select t.id from tracked t)) as is_tracked,
           (e.brand_id in (select c.brand_id from competitor_ids c)) as is_competitor
    from responses resp
    join public.response_brand_evidence e on e.response_id = resp.id and e.project_id = p_project_id
  ),
  prompt_stats as (
    select ev.prompt_text,
           coalesce(max(ev.prompt_category), max(ev.evidence_category)) as category,
           bool_or(ev.is_tracked) as brand_seen,
           count(distinct ev.response_id) filter (where ev.is_competitor) as competitor_responses
    from evidence ev
    group by ev.prompt_text
  ),
  competitor_counts as (
    select ev.prompt_text, b.canonical_name, count(*) as n
    from evidence ev
    join public.brand_registry b on b.id = ev.brand_id
    where ev.is_competitor
    group by ev.prompt_text, b.canonical_name
  )
  select s.prompt_text,
         s.category,
         (select array_agg(c.canonical_name order by c.n desc, c.canonical_name)
            from (select cc.canonical_name, cc.n from competitor_counts cc where cc.prompt_text = s.prompt_text
                  order by cc.n desc, cc.canonical_name limit 3) c)
  from prompt_stats s
  where not s.brand_seen and s.competitor_responses > 0
  order by s.competitor_responses desc, s.prompt_text
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$function$;

revoke all on function public.get_report_prompt_gaps(uuid, date, date, text, integer) from public, anon;
grant execute on function public.get_report_prompt_gaps(uuid, date, date, text, integer) to authenticated, service_role;
