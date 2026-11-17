#!/usr/bin/env bash
set -euo pipefail

: "${DB_URL:?DB_URL is required}"
PROJECT_ID="10000000-0000-4000-8000-000000000001"
PROMPT_ID="20000000-0000-4000-8000-000000000001"
OLD_RUN_ID="30000000-0000-4000-8000-000000000001"
FIRST_RUN_ID="40000000-0000-4000-8000-000000000001"
SECOND_RUN_ID="50000000-0000-4000-8000-000000000001"

# Seed a predecessor and two complete unpublished candidates for one exact scope.
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
begin;
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);
do \$\$
declare
  v_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  insert into public.projects (id, brand_name, categories, tracking_market, tracking_locations)
  values ('$PROJECT_ID', 'Synthetic Concurrent Replacement', array['Skin'], 'MY', array['MY']);

  insert into public.prompts (id, project_id, prompt_number, prompt, category, language, active)
  values ('$PROMPT_ID', '$PROJECT_ID', 1, 'Concurrent replacement prompt', 'Skin', 'English', true);

  insert into public.tracking_runs (
    id, project_id, provider, status, total_prompts, completed_prompts,
    started_at, tracking_location, category, run_kind
  ) values ('$OLD_RUN_ID', '$PROJECT_ID', 'chatgpt', 'running', 1, 0, now(), 'MY', 'Skin', 'topic');

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values (
    '$PROJECT_ID', '$PROMPT_ID', 'chatgpt', now(), 'Concurrent replacement prompt',
    '{"run":"predecessor"}'::jsonb, 'Predecessor response', 'completed', '$OLD_RUN_ID', 'MY'
  );

  perform public.stage_tracking_candidate_rows('$OLD_RUN_ID', 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', '$PROJECT_ID', 'metric_date', v_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', '$OLD_RUN_ID',
      'visibility_score', 0, 'visibility_rank', null, 'rank_population_count', null,
      'rank_population_status', 'unverified', 'citation_count', 0, 'presence_count', 0, 'response_count', 1
    )));
  update public.tracking_runs set status='completed',completed_prompts=1,completed_at=now() where id='$OLD_RUN_ID';
  if public.promote_tracking_run_candidate('$OLD_RUN_ID', null)->>'status' <> 'published' then
    raise exception 'concurrency predecessor publication failed';
  end if;

  insert into public.tracking_runs (
    id, project_id, provider, status, total_prompts, completed_prompts,
    started_at, tracking_location, category, run_kind
  ) values
    ('$FIRST_RUN_ID', '$PROJECT_ID', 'chatgpt', 'running', 1, 0, now(), 'MY', 'Skin', 'topic'),
    ('$SECOND_RUN_ID', '$PROJECT_ID', 'chatgpt', 'running', 1, 0, now(), 'MY', 'Skin', 'topic');

  insert into public.ai_responses (
    project_id, prompt_id, llm_provider, captured_at, prompt_snapshot,
    raw_response, response_text, response_status, run_id, tracking_location
  ) values
    ('$PROJECT_ID', '$PROMPT_ID', 'chatgpt', now(), 'Concurrent replacement prompt',
     '{"run":"first-candidate"}'::jsonb, 'First candidate response', 'completed', '$FIRST_RUN_ID', 'MY'),
    ('$PROJECT_ID', '$PROMPT_ID', 'chatgpt', now(), 'Concurrent replacement prompt',
     '{"run":"second-candidate"}'::jsonb, 'Second candidate response', 'completed', '$SECOND_RUN_ID', 'MY');

  perform public.stage_tracking_candidate_rows('$FIRST_RUN_ID', 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', '$PROJECT_ID', 'metric_date', v_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', '$FIRST_RUN_ID',
      'visibility_score', 0, 'visibility_rank', null, 'rank_population_count', null,
      'rank_population_status', 'unverified', 'citation_count', 0, 'presence_count', 0, 'response_count', 1
    )));
  perform public.stage_tracking_candidate_rows('$SECOND_RUN_ID', 'visibility_daily',
    jsonb_build_array(jsonb_build_object(
      'project_id', '$PROJECT_ID', 'metric_date', v_date, 'category', 'Skin',
      'llm_provider', 'chatgpt', 'tracking_location', 'MY', 'run_id', '$SECOND_RUN_ID',
      'visibility_score', 0, 'visibility_rank', null, 'rank_population_count', null,
      'rank_population_status', 'unverified', 'citation_count', 0, 'presence_count', 0, 'response_count', 1
    )));
  update public.tracking_runs set status='completed',completed_prompts=1,completed_at=now()
  where id in ('$FIRST_RUN_ID','$SECOND_RUN_ID');
end
\$\$;
commit;
SQL

# Session 1 publishes the first candidate and deliberately holds its transaction
# locks for three seconds. Session 2 starts only after both locks are visible.
psql "$DB_URL" -v ON_ERROR_STOP=1 > /tmp/replacement-concurrency-session-1.log 2>&1 <<SQL &
begin;
set local role postgres;
set application_name = 'replacement-concurrency-session-1';
select set_config('request.jwt.claim.role', 'service_role', true);
select public.promote_tracking_run_candidate('$FIRST_RUN_ID', null);
select pg_sleep(3);
commit;
SQL
PID1=$!

LOCKED=0
for _ in $(seq 1 80); do
  if ! kill -0 "$PID1" 2>/dev/null; then
    cat /tmp/replacement-concurrency-session-1.log
    wait "$PID1"
  fi
  COUNT=$(psql "$DB_URL" -Atqc "select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where l.locktype='advisory' and l.granted and a.application_name='replacement-concurrency-session-1'")
  if [[ "$COUNT" -ge 2 ]]; then LOCKED=1; break; fi
  sleep 0.1
done
if [[ "$LOCKED" -ne 1 ]]; then
  cat /tmp/replacement-concurrency-session-1.log
  echo "Session 1 did not acquire both category and Overall advisory locks." >&2
  kill "$PID1" 2>/dev/null || true
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 > /tmp/replacement-concurrency-session-2.log 2>&1 <<SQL &
begin;
set local role postgres;
set application_name = 'replacement-concurrency-session-2';
select set_config('request.jwt.claim.role', 'service_role', true);
select public.promote_tracking_run_candidate('$SECOND_RUN_ID', null);
commit;
SQL
PID2=$!

wait "$PID1" || { cat /tmp/replacement-concurrency-session-1.log; exit 1; }
wait "$PID2" || { cat /tmp/replacement-concurrency-session-2.log; exit 1; }

# The second promotion must see the first promotion's run as its fresh predecessor.
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
do \$\$
declare
  v_project uuid := '$PROJECT_ID';
  v_old uuid := '$OLD_RUN_ID';
  v_first uuid := '$FIRST_RUN_ID';
  v_second uuid := '$SECOND_RUN_ID';
  v_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if exists (select 1 from public.tracking_runs where id in (v_old,v_first)) then
    raise exception 'concurrent replacement left an obsolete predecessor run';
  end if;
  if not exists (select 1 from public.tracking_runs where id=v_second and published_at is not null and superseded_at is null) then
    raise exception 'second concurrent candidate did not become canonical';
  end if;
  if exists (select 1 from public.ai_responses where run_id in (v_old,v_first)) then
    raise exception 'concurrent replacement left predecessor raw responses';
  end if;
  if (select count(*) from public.ai_responses where run_id=v_second) <> 1 then
    raise exception 'final candidate raw response count is incorrect';
  end if;
  if (select count(*) from public.tracking_run_replacements where project_id=v_project) <> 2 then
    raise exception 'concurrent replacement audit lineage should contain both promotion edges';
  end if;
  if not exists (
    select 1 from public.visibility_daily
    where project_id=v_project and metric_date=v_date and category='Skin'
      and llm_provider='chatgpt' and tracking_location='MY' and run_id=v_second
  ) then
    raise exception 'final canonical metric does not belong to second candidate';
  end if;
end
\$\$;
delete from public.tracking_run_replacements where project_id='$PROJECT_ID';
-- ai_responses.project_id is SET NULL while prompts are project-cascaded; remove
-- the synthetic responses first so their prompt FK cannot block project teardown.
delete from public.ai_responses where project_id='$PROJECT_ID';
delete from public.projects where id='$PROJECT_ID';
SQL

echo "Concurrent same-scope replacement behavioural test passed."
