-- Correct metric finalisation for runs spanning multiple tracking locations.
-- Candidate promotion invokes finalize_run_metrics after all staged rows are promoted.
-- The old two-argument helper pooled responses across locations, producing incorrect
-- per-location counts/ranks when a project tracks more than one country.

create or replace function public.run_tracked_presence(
  p_run_id uuid,
  p_category text,
  p_tracking_location text
)
returns table(presence_count integer, response_count integer)
language sql
stable
security definer
set search_path = public
as $$
  with run_scope as (
    select coalesce(t.source_run_id, t.id) as source_run_id
    from public.tracking_runs t
    where t.id = p_run_id
  ),
  resp as (
    select ar.id
    from public.ai_responses ar
    join run_scope rs on rs.source_run_id = ar.run_id
    left join public.prompts pr on pr.id = ar.prompt_id
    where ar.response_status = 'completed'
      and ar.tracking_location = p_tracking_location
      and (p_category = 'Overall' or pr.category = p_category)
  )
  select
    (
      select count(distinct e.response_id)::integer
      from public.response_brand_evidence e
      join public.brand_registry b on b.id = e.brand_id and b.is_tracked_brand
      join resp r on r.id = e.response_id
      where e.match_source = 'response_text'
    ),
    (select count(*)::integer from resp);
$$;

create or replace function public.finalize_run_metrics(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.tracking_runs%rowtype;
  r record;
  v_pres integer;
  v_resp integer;
  v_rank record;
  v_updated integer := 0;
begin
  select * into v_run from public.tracking_runs where id = p_run_id;
  if not found then return 0; end if;

  for r in
    select id, category, metric_date, tracking_location, visibility_score
    from public.visibility_daily
    where run_id = p_run_id
  loop
    select t.presence_count, t.response_count
      into v_pres, v_resp
    from public.run_tracked_presence(p_run_id, r.category, r.tracking_location) t;

    if coalesce(v_resp, 0) > 0
       and r.visibility_score is not null
       and abs(round(v_pres::numeric / v_resp * 100, 1) - r.visibility_score) > 0.05 then
      raise exception 'PUBLICATION_BLOCKED: stored visibility % for % on % at % does not match % of % valid responses (run %)',
        r.visibility_score, r.category, r.metric_date, r.tracking_location, v_pres, v_resp, p_run_id;
    end if;

    select * into v_rank from public.canonical_scoped_rank(
      v_run.project_id, p_run_id, r.category, r.metric_date,
      v_run.provider, r.tracking_location, v_pres, v_resp
    );

    update public.visibility_daily set
      presence_count = case when v_resp > 0 then v_pres end,
      response_count = case when v_resp > 0 then v_resp end,
      visibility_rank = v_rank.visibility_rank,
      rank_population_count = v_rank.rank_population_count,
      rank_population_status = v_rank.rank_population_status,
      source_run_ids = array[p_run_id],
      metric_version = 'v2'
    where id = r.id;
    v_updated := v_updated + 1;
  end loop;
  return v_updated;
end;
$$;

revoke all on function public.run_tracked_presence(uuid, text, text) from public, anon, authenticated;
grant execute on function public.run_tracked_presence(uuid, text, text) to service_role;
revoke all on function public.finalize_run_metrics(uuid) from public, anon, authenticated;
grant execute on function public.finalize_run_metrics(uuid) to service_role;
