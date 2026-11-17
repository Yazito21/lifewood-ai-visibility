-- Leaderboard run lookup must resolve only the active published run.
-- Superseded runs remain stored for audit but must never be selected for current metrics.

do $$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(
    'public.get_published_run_ids_for_leaderboard(uuid,date,date,text,text,text)'::regprocedure
  ) into v_definition;

  if position('superseded_at' in lower(v_definition)) > 0 then
    return;
  end if;

  v_patched := regexp_replace(
    v_definition,
    'and tr\.status\s*=\s*''completed''\s+and tr\.published_at is not null',
    'and tr.status = ''completed'' and tr.published_at is not null and tr.superseded_at is null',
    'i'
  );

  if v_patched = v_definition then
    raise exception 'Could not locate the completed/published filter in get_published_run_ids_for_leaderboard';
  end if;

  execute v_patched;
end
$$;

comment on function public.get_published_run_ids_for_leaderboard(uuid,date,date,text,text,text) is
  'Returns the latest active, completed, published run for each Malaysia-local date and selected category/provider/location. Superseded runs are excluded.';
