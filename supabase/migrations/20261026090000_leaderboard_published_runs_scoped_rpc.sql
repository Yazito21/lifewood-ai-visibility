-- Scoped, authorized published run lookup for Leaderboards.
create or replace function public.get_published_run_ids_for_leaderboard(
  p_project_id uuid, p_start_date date, p_end_date date, p_topic text, p_provider text, p_tracking_location text
) returns table(metric_date date, run_id uuid)
language sql stable security definer set search_path=public as $$
  with scoped_runs as (
    select (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date as metric_date,
      tr.id as run_id, tr.published_at,
      row_number() over (partition by (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date order by tr.published_at desc,tr.id desc) as rn
    from public.tracking_runs tr
    where tr.project_id=p_project_id and public.is_project_member(p_project_id)
      and tr.provider=p_provider and tr.tracking_location=p_tracking_location
      and tr.status='completed' and tr.published_at is not null
      and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date between p_start_date and p_end_date
      and ((p_topic='Overall' and tr.topic is null) or (p_topic<>'Overall' and (tr.topic=p_topic or tr.topic is null)))
  ) select sr.metric_date,sr.run_id from scoped_runs sr where sr.rn=1;
$$;
revoke all on function public.get_published_run_ids_for_leaderboard(uuid,date,date,text,text,text) from public;
grant execute on function public.get_published_run_ids_for_leaderboard(uuid,date,date,text,text,text) to authenticated,service_role;