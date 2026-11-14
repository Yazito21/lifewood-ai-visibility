    evidence_text = excluded.evidence_text, first_position = excluded.first_position,
    occurrence_count = excluded.occurrence_count;
  get diagnostics v_evidence = row_count;

  -- 3c. Citation occurrences: cited URLs (url_citation annotations) attributed by domain to each entity.
  -- Competitors are rebuilt for their current set. The tracked brand is rebuilt only where it has no normalized
  -- occurrences yet (older days), so already-correct tracked counts are left untouched.
  create temp table _cm_cit_entities on commit drop as
  select e.category, e.brand_id, e.websites, false as is_tracked from _cm_entities e
  union all
  select tp.category_name, v_tracked_id, coalesce(v_tracked_sites, '{}'), true
  from unnest(v_categories) as tp(category_name) where v_tracked_id is not null;

  create temp table _cm_tracked_missing on commit drop as
  select u.unit_run from _cm_units u
  where v_tracked_id is not null and not exists (
    select 1 from public.citation_occurrences co join _cm_resp r on r.response_id = co.response_id
    where r.unit_run = u.unit_run and co.entity_id = v_tracked_id);

  create temp table _cm_cit on commit drop as
  select distinct r.unit_run, r.src_run, r.response_id, r.category, r.loc, r.d, r.provider, e.brand_id, e.is_tracked,
         cu.url as citation_url, public.canonicalize_citation_url(cu.url) as canonical_url,
         lower(split_part(split_part(regexp_replace(public.canonicalize_citation_url(cu.url), '^https?://', '', 'i'), '/', 1), ':', 1)) as host
  from _cm_resp r
  cross join lateral (
    select a ->> 'url' as url
    from jsonb_path_query(r.raw_response, '$.output[*].content[*].annotations[*] ? (@.type == "url_citation")') a
  ) cu
  join _cm_cit_entities e on e.category = r.category
  where cu.url ~* '^https?://'
    and (not e.is_tracked or r.unit_run in (select unit_run from _cm_tracked_missing))
    and exists (select 1 from unnest(e.websites) w
                where lower(split_part(split_part(regexp_replace(public.canonicalize_citation_url(cu.url), '^https?://', '', 'i'), '/', 1), ':', 1)) = w
                   or lower(split_part(split_part(regexp_replace(public.canonicalize_citation_url(cu.url), '^https?://', '', 'i'), '/', 1), ':', 1)) like '%.' || w);

  delete from public.citation_occurrences co
  using _cm_resp r, _cm_entities e
  where co.response_id = r.response_id and co.entity_id = e.brand_id and e.category = r.category;
  insert into public.citation_occurrences (
    project_id, response_id, entity_id, category, metric_date, provider, tracking_location, run_id,
    citation_url, canonical_url, canonical_domain, citation_index)
  select distinct on (response_id, brand_id, canonical_url)
         p_project_id, response_id, brand_id, category, d, provider, loc, src_run, citation_url, canonical_url, host, 1
  from _cm_cit
  order by response_id, brand_id, canonical_url, citation_url
  on conflict (response_id, entity_id, canonical_url) do nothing;
  get diagnostics v_citations = row_count;

  -- Tracked-brand daily citation count for the units that were just (re)built.
  update public.visibility_daily v set citation_count = x.n
  from (select m.unit_run, count(distinct c.response_id::text || '|' || c.canonical_url)::integer as n  -- NULL-safe: a unit with no tracked citations counts 0, not 1
        from _cm_tracked_missing m
        left join _cm_cit c on c.unit_run = m.unit_run and c.is_tracked
        group by m.unit_run) x
  where v.run_id = x.unit_run;

  -- 3d. Competitor observations for every unit (zero-presence competitors included).
  insert into public.category_brand_observations (
    project_id, brand_id, category, metric_date, tracking_location, llm_provider,
    presence_count, response_count, mention_count, citation_count, average_position, run_id)
  select p_project_id, e.brand_id, u.category, u.d, u.loc, u.provider,
         coalesce(h.presence, 0), rc.n, coalesce(h.mentions, 0), coalesce(cc.n, 0), ap.avg_pos, u.unit_run
  from _cm_units u
  join (select unit_run, count(*)::integer as n from _cm_resp group by unit_run) rc on rc.unit_run = u.unit_run
  join _cm_entities e on e.category = u.category
  left join (select unit_run, brand_id, count(*)::integer as presence, sum(n)::integer as mentions
             from _cm_hits where not is_tracked group by unit_run, brand_id) h
         on h.unit_run = u.unit_run and h.brand_id = e.brand_id
  left join (select unit_run, brand_id, count(distinct (response_id, canonical_url))::integer as n
             from _cm_cit where not is_tracked group by unit_run, brand_id) cc
         on cc.unit_run = u.unit_run and cc.brand_id = e.brand_id
  left join (select unit_run, brand_id, round(avg(rk)::numeric, 2) as avg_pos
             from (select unit_run, brand_id,
                          row_number() over (partition by response_id order by pos, is_tracked desc, brand_id) as rk
                   from _cm_hits) z group by unit_run, brand_id) ap
         on ap.unit_run = u.unit_run and ap.brand_id = e.brand_id
  on conflict (project_id, brand_id, category, metric_date, tracking_location, llm_provider) do update set
    presence_count = excluded.presence_count, response_count = excluded.response_count,
    mention_count = excluded.mention_count, citation_count = excluded.citation_count,
    average_position = excluded.average_position, run_id = excluded.run_id;
  get diagnostics v_obs = row_count;

  -- 3e. Archive then remove derived observations of brands that are no longer competitors in these scopes.
  insert into public.category_brand_observations_archive
  select o.*, now(), 'competitor set replaced'
  from public.category_brand_observations o
  join _cm_units u on u.category = o.category and u.d = o.metric_date and u.loc = o.tracking_location and u.provider = o.llm_provider
  where o.project_id = p_project_id
    and not exists (select 1 from _cm_entities e where e.category = o.category and e.brand_id = o.brand_id);
  get diagnostics v_archived = row_count;
  delete from public.category_brand_observations o
  using _cm_units u
  where o.project_id = p_project_id and u.category = o.category and u.d = o.metric_date
    and u.loc = o.tracking_location and u.provider = o.llm_provider
    and not exists (select 1 from _cm_entities e where e.category = o.category and e.brand_id = o.brand_id);

  -- 3f. Tracked-brand share of voice and position for imported daily rows that have none yet.
  update public.visibility_daily v set
    share_of_voice_score = x.sov, share_of_voice_rank = x.sov_rank,
    average_position = x.pos, average_position_rank = x.pos_rank
  from (
    select u.unit_run,
           case when t.total > 0 then round(t.mine::numeric / t.total * 100, 1) else 0 end as sov,
           1 + (select count(*) from public.category_brand_observations o
                where o.run_id = u.unit_run and o.category = u.category and o.response_count > 0 and o.mention_count > t.mine)::integer as sov_rank,
           tp.avg_pos as pos,
           case when tp.avg_pos is not null and exists (
                  select 1 from public.category_brand_observations o
                  where o.run_id = u.unit_run and o.category = u.category and o.average_position is not null)
                then 1 + (select count(*) from public.category_brand_observations o
                          where o.run_id = u.unit_run and o.category = u.category and o.average_position is not null
                            and o.average_position < tp.avg_pos)::integer end as pos_rank
    from _cm_units u
    cross join lateral (select coalesce(sum(h.n) filter (where h.is_tracked), 0) as mine, coalesce(sum(h.n), 0) as total
                        from _cm_hits h where h.unit_run = u.unit_run) t
    left join lateral (
      select round(avg(z.rk)::numeric, 2) as avg_pos
      from (select row_number() over (partition by hh.response_id order by hh.pos, hh.is_tracked desc, hh.brand_id) as rk, hh.is_tracked, hh.pos
            from _cm_hits hh where hh.unit_run = u.unit_run) z
      where z.is_tracked and z.pos is not null) tp on true
    where exists (select 1 from public.tracking_runs t2 where t2.id = u.unit_run and t2.data_source = 'profound_import')
  ) x
  where v.run_id = x.unit_run and v.share_of_voice_score is null;

  -- 4. Rank + population via the canonical implementation; a unit whose tracked score no longer reproduces is reported.
  for ur in select * from _cm_units order by d, category loop
    begin
      perform public.finalize_run_metrics(ur.unit_run);
      v_units := v_units + 1;
    exception when others then
      v_blocked := v_blocked || jsonb_build_object('date', ur.d, 'topic', ur.category, 'reason', sqlerrm);
    end;
  end loop;

  -- 5. Overall pools the category runs of each day.
  for ur in select distinct d, loc, provider from _cm_units order by d loop
    if public.publish_engine_overall_metrics(p_project_id, ur.d, ur.loc, ur.provider, not exists (
        select 1 from public.tracking_runs tx
        where tx.project_id = p_project_id and tx.tracking_location = ur.loc and tx.run_kind = 'topic'
          and tx.status = 'completed' and tx.published_at is not null and tx.superseded_at is null
          and tx.provider <> 'Overall' and tx.provider <> ur.provider
          and (tx.published_at at time zone 'Asia/Kuala_Lumpur')::date = ur.d)) is not null then
      v_overall := v_overall + 1;
    end if;
    -- Days with several engines are also pooled across engines (idempotent per day).
    if exists (select 1 from public.tracking_runs tx
               where tx.project_id = p_project_id and tx.tracking_location = ur.loc and tx.run_kind = 'topic'
                 and tx.status = 'completed' and tx.published_at is not null and tx.superseded_at is null
                 and tx.provider <> 'Overall' and tx.provider <> ur.provider
                 and (tx.published_at at time zone 'Asia/Kuala_Lumpur')::date = ur.d) then
      perform public.publish_cross_engine_metrics(p_project_id, ur.d, ur.loc);
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'completed', 'competitors', v_entities, 'slices_backfilled', v_slices,
    'units_finalized', v_units, 'overall_days', v_overall,
    'observations_written', v_obs, 'evidence_rows', v_evidence, 'citation_occurrences_added', v_citations,
    'observations_archived', v_archived, 'slices_unverified', v_skipped, 'units_blocked', v_blocked);
end;
$_$;


ALTER FUNCTION "public"."recompute_competitor_metrics"("p_project_id" "uuid", "p_date_from" "date", "p_date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_stale_tracking_runs"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  updated_count integer := 0;
  current_count integer := 0;
begin
  with response_counts as (
    select
      ar.run_id,
      count(*) filter (where ar.response_status = 'completed')::integer as completed_count
    from public.ai_responses ar
    group by ar.run_id
  )
  update public.tracking_runs tr
  set
    status = case when coalesce(rc.completed_count, 0) > 0 then 'partial' else 'failed' end,
    completed_prompts = coalesce(rc.completed_count, 0),
    failed_prompts = greatest(tr.total_prompts - coalesce(rc.completed_count, 0), 0),
    error_message = case
      when coalesce(rc.completed_count, 0) > 0
        then 'Run was interrupted before finalization. Saved responses were preserved; recover metrics before rerunning prompts.'
      else 'Run was interrupted before responses were saved. Check Edge Function logs before retrying.'
    end,
    completed_at = now()
  from response_counts rc
  where tr.id = rc.run_id
    and tr.status = 'running'
    and tr.started_at < now() - interval '10 minutes';

  get diagnostics current_count = row_count;
  updated_count := updated_count + current_count;

  -- Runs with no persisted responses also need to be closed.
  update public.tracking_runs tr
  set
    status = 'failed',
    completed_prompts = 0,
    failed_prompts = tr.total_prompts,
    error_message = 'Run was interrupted before responses were saved. Check Edge Function logs before retrying.',
    completed_at = now()
  where tr.status = 'running'
    and tr.started_at < now() - interval '10 minutes'
    and not exists (
      select 1 from public.ai_responses ar where ar.run_id = tr.id
    );

  get diagnostics current_count = row_count;
  updated_count := updated_count + current_count;
  return updated_count;
end;
$$;


ALTER FUNCTION "public"."reconcile_stale_tracking_runs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_competitor_recompute"("p_project_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
    or exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = auth.uid() and m.role in ('admin', 'superadmin'))
  ) then
    raise exception 'Only project admins can request a recompute.';
  end if;
  return public.enqueue_competitor_recompute(p_project_id, 'manual_request');
end;
$$;


ALTER FUNCTION "public"."request_competitor_recompute"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_tracked_presence"("p_run_id" "uuid", "p_category" "text") RETURNS TABLE("presence_count" integer, "response_count" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with resp as (
    select ar.id
    from public.ai_responses ar
    left join public.prompts pr on pr.id = ar.prompt_id
    where ar.run_id = coalesce((select t.source_run_id from public.tracking_runs t where t.id = p_run_id), p_run_id)
      and ar.response_status = 'completed'
      and (p_category = 'Overall' or pr.category = p_category)
  )
  select
    (select count(distinct e.response_id)::integer
       from public.response_brand_evidence e
       join public.brand_registry b on b.id = e.brand_id and b.is_tracked_brand
       join resp r on r.id = e.response_id
      where e.match_source = 'response_text'),
    (select count(*)::integer from resp);
$$;


ALTER FUNCTION "public"."run_tracked_presence"("p_run_id" "uuid", "p_category" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_my_ui_preferences"("p_preferences" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_theme text;
  v_text_size integer;
  v_scale integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_theme := coalesce(p_preferences ->> 'theme', 'light');
  v_text_size := coalesce((p_preferences ->> 'text_size')::integer, 100);
  v_scale := coalesce((p_preferences ->> 'scale')::integer, 100);

  if v_theme not in ('light', 'dark') then
    raise exception 'Invalid theme preference' using errcode = '22023';
  end if;

  if v_text_size not in (75, 90, 100, 110, 125) then
    raise exception 'Invalid text size preference' using errcode = '22023';
  end if;

  if v_scale not in (75, 90, 100, 110, 125) then
    raise exception 'Invalid platform scale preference' using errcode = '22023';
  end if;

  update public.profiles
  set ui_preferences = jsonb_build_object(
    'theme', v_theme,
    'text_size', v_text_size,
    'scale', v_scale
  ),
  updated_at = now()
  where id = v_user_id;

  if not found then
    raise exception 'User profile not found' using errcode = 'P0002';
  end if;
end;
$$;


ALTER FUNCTION "public"."save_my_ui_preferences"("p_preferences" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."site_host"("v" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select nullif(split_part(split_part(regexp_replace(regexp_replace(
    lower(btrim(coalesce(v, ''))), '^https?://', ''), '^www[.]', ''), '/', 1), ':', 1), '')
$$;


ALTER FUNCTION "public"."site_host"("v" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."text_contains_any_term_boundary"("p_text" "text", "p_terms" "text"[]) RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_text text := lower(coalesce(p_text, ''));
  v_term text;
  v_pos integer;
  v_from integer;
  v_len integer;
BEGIN
  FOREACH v_term IN ARRAY coalesce(p_terms, ARRAY[]::text[]) LOOP
    v_term := lower(btrim(v_term));
    v_len := length(v_term);
    IF v_len <= 1 THEN
      CONTINUE;
    END IF;
    v_from := 1;
    LOOP
      v_pos := strpos(substr(v_text, v_from), v_term);
      EXIT WHEN v_pos = 0;
      v_pos := v_pos + v_from - 1;
      IF (v_pos = 1 OR substr(v_text, v_pos - 1, 1) !~ '[a-z0-9]')
         AND (v_pos + v_len > length(v_text) OR substr(v_text, v_pos + v_len, 1) !~ '[a-z0-9]') THEN
        RETURN true;
      END IF;
      v_from := v_pos + 1;
    END LOOP;
  END LOOP;
  RETURN false;
END;
$$;


ALTER FUNCTION "public"."text_contains_any_term_boundary"("p_text" "text", "p_terms" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tracking_runs_publication_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_prior uuid;
begin
  if tg_op = 'INSERT' then
    if new.run_kind is null then
      new.run_kind := case when new.category is null then 'full' else 'topic' end;
    end if;
    return new;
  end if;

  if new.category is not null and new.run_kind is distinct from 'topic' and new.run_kind is distinct from 'overall_aggregate' then
    new.run_kind := 'topic';
  end if;

  if new.published_at is not null and old.published_at is null and new.status = 'completed' then
    with prior as (
      update public.tracking_runs o set superseded_at = now()
      where o.id <> new.id and o.project_id = new.project_id and o.provider = new.provider
        and o.tracking_location = new.tracking_location
        and coalesce(o.category, '') = coalesce(new.category, '')
        and coalesce(o.run_kind, '') = coalesce(new.run_kind, '')
        and o.status = 'completed' and o.published_at is not null and o.superseded_at is null
        and (o.published_at at time zone 'Asia/Kuala_Lumpur')::date = (new.published_at at time zone 'Asia/Kuala_Lumpur')::date
      returning o.id
    )
    select id into v_prior from prior limit 1;
    new.supersedes_run_id := coalesce(new.supersedes_run_id, v_prior);
    new.superseded_at := null;
    if new.run_kind <> 'overall_aggregate' then
      perform public.finalize_run_metrics(new.id);
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."tracking_runs_publication_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_rebuild_overall_after_batch_completion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    perform public.rebuild_overall_metrics_for_tracking_batch(new.id);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trigger_rebuild_overall_after_batch_completion"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "private"."llm_secrets" (
    "project_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "ciphertext" "text" NOT NULL,
    "key_last4" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "private"."llm_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "prompt_id" "uuid",
    "llm_provider" "text" NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prompt_snapshot" "text" NOT NULL,
    "raw_response" "jsonb" NOT NULL,
    "response_text" "text",
    "response_status" "text",
    "error_message" "text",
    "run_id" "uuid",
    "project_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "brand_name_snapshot" "text",
    "tracking_location" "text" DEFAULT 'LEGACY'::"text" NOT NULL,
    "response_analysis" "jsonb" DEFAULT '{"status": "not_run", "entities": []}'::"jsonb" NOT NULL,
    "data_source" "text",
    CONSTRAINT "ai_responses_llm_provider_check" CHECK (("llm_provider" = ANY (ARRAY['chatgpt'::"text", 'gemini'::"text", 'perplexity'::"text", 'google_ai_overview'::"text", 'claude'::"text"]))),
    CONSTRAINT "ai_responses_tracking_location_check" CHECK ((("tracking_location" = 'LEGACY'::"text") OR ("tracking_location" = 'GLOBAL'::"text") OR ("tracking_location" ~ '^[A-Z]{2}$'::"text")))
);


ALTER TABLE "public"."ai_responses" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ai_responses"."tracking_location" IS 'Country code or GLOBAL used for this response; LEGACY means location was not reliably recorded.';



COMMENT ON COLUMN "public"."ai_responses"."response_analysis" IS 'Derived entity extraction and research-source metadata. raw_response remains the original provider payload.';



CREATE TABLE IF NOT EXISTS "public"."ai_usage_log" (
    "id" bigint NOT NULL,
    "project_id" "uuid",
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_tokens" integer,
    "completion_tokens" integer,
    "cost_usd" numeric(12,6),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_usage_log_action_check" CHECK (("action" = ANY (ARRAY['analyze'::"text", 'generate'::"text", 'audit_eeat'::"text", 'audit_narrative'::"text"])))
);


ALTER TABLE "public"."ai_usage_log" OWNER TO "postgres";


ALTER TABLE "public"."ai_usage_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_usage_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."audit_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "requested_by" "uuid",
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "period_label" "text",
    "tracking_location" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "step" "text",
    "visibility_snapshot" "jsonb",
    "audit" "jsonb",
    "narrative" "jsonb",
    "edits" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ai_visibility_score" numeric,
    "geo_score" numeric,
    "seo_score" numeric,
    "ai_cost_usd" numeric(12,6),
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "audit_reports_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."audit_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brand_registry" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "canonical_name" "text" NOT NULL,
    "normalized_key" "text" NOT NULL,
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "primary_website" "text",
    "additional_websites" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_tracked_brand" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brand_registry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."category_brand_assignments" (
    "project_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'competitor'::"text" NOT NULL,
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "websites" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "include_in_metrics" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "category_brand_assignments_role_check" CHECK (("role" = ANY (ARRAY['tracked_brand'::"text", 'competitor'::"text"])))
);


ALTER TABLE "public"."category_brand_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."category_brand_assignments_archive" (
    "project_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "aliases" "text"[] NOT NULL,
    "websites" "text"[] NOT NULL,
    "include_in_metrics" boolean NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archive_reason" "text"
);


ALTER TABLE "public"."category_brand_assignments_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."category_brand_observations" (
    "project_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "metric_date" "date" NOT NULL,
    "tracking_location" "text" DEFAULT 'LEGACY'::"text" NOT NULL,
    "llm_provider" "text" DEFAULT 'chatgpt'::"text" NOT NULL,
    "presence_count" integer DEFAULT 0 NOT NULL,
    "response_count" integer DEFAULT 0 NOT NULL,
    "mention_count" integer DEFAULT 0 NOT NULL,
    "citation_count" integer DEFAULT 0 NOT NULL,
    "average_position" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "run_id" "uuid",
    CONSTRAINT "category_brand_observations_citation_count_check" CHECK (("citation_count" >= 0)),
    CONSTRAINT "category_brand_observations_mention_count_check" CHECK (("mention_count" >= 0)),
    CONSTRAINT "category_brand_observations_presence_count_check" CHECK (("presence_count" >= 0)),
    CONSTRAINT "category_brand_observations_response_count_check" CHECK (("response_count" >= 0))
);


ALTER TABLE "public"."category_brand_observations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."category_brand_observations"."run_id" IS 'Tracking run that last published this canonical daily brand observation; null for legacy rows.';



CREATE TABLE IF NOT EXISTS "public"."category_brand_observations_archive" (
    "project_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "metric_date" "date" NOT NULL,
    "tracking_location" "text" NOT NULL,
    "llm_provider" "text" NOT NULL,
    "presence_count" integer NOT NULL,
    "response_count" integer NOT NULL,
    "mention_count" integer NOT NULL,
    "citation_count" integer NOT NULL,
    "average_position" numeric,
    "created_at" timestamp with time zone NOT NULL,
    "run_id" "uuid",
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archive_reason" "text"
);


ALTER TABLE "public"."category_brand_observations_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."citation_occurrences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "response_id" "uuid" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "metric_date" "date" NOT NULL,
    "provider" "text" NOT NULL,
    "tracking_location" "text" NOT NULL,
    "run_id" "uuid",
    "citation_url" "text" NOT NULL,
    "canonical_url" "text" NOT NULL,
    "canonical_domain" "text" NOT NULL,
    "citation_index" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "citation_occurrences_citation_index_check" CHECK (("citation_index" > 0))
);


ALTER TABLE "public"."citation_occurrences" OWNER TO "postgres";


COMMENT ON TABLE "public"."citation_occurrences" IS 'Normalized per-response citation attribution. Unit: one canonical cited URL per valid response and entity. Identical URLs repeated within one response count once; the same URL across separate responses counts once per response.';



CREATE TABLE IF NOT EXISTS "public"."citations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "metric_date" "date" NOT NULL,
    "category" "text",
    "llm_provider" "text",
    "url" "text" NOT NULL,
    "page_name" "text",
    "brand_name" "text",
    "is_brand_related" boolean DEFAULT false NOT NULL,
    "frequency" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prompt_id" "uuid",
    "tracking_location" "text" DEFAULT 'LEGACY'::"text" NOT NULL,
    CONSTRAINT "citations_tracking_location_check" CHECK ((("tracking_location" = 'LEGACY'::"text") OR ("tracking_location" = 'GLOBAL'::"text") OR ("tracking_location" ~ '^[A-Z]{2}$'::"text")))
);


ALTER TABLE "public"."citations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."citations"."tracking_location" IS 'Country code or GLOBAL for the originating tracking data; LEGACY means location was not reliably recorded.';



CREATE TABLE IF NOT EXISTS "public"."client_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "report_type" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "period_label" "text",
    "tracking_location" "text" NOT NULL,
    "snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "content" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_reports_report_type_check" CHECK (("report_type" = ANY (ARRAY['monthly'::"text", 'simple'::"text", 'introductory'::"text", 'technical_audit'::"text", 'competitor_comparison'::"text"]))),
    CONSTRAINT "client_reports_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'finalized'::"text"]))),
    CONSTRAINT "client_reports_valid_period" CHECK (("period_end" >= "period_start"))
);


ALTER TABLE "public"."client_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competitor_recompute_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "reason" "text" DEFAULT 'competitor_set_changed'::"text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "requested_by" "uuid",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "summary" "jsonb",
    "error_message" "text",
    CONSTRAINT "competitor_recompute_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."competitor_recompute_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competitors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "metric_date" "date" NOT NULL,
    "category" "text",
    "llm_provider" "text",
    "brand_name" "text" NOT NULL,
    "website" "text",
    "visibility_score" numeric(10,4),
    "citation_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tracking_location" "text" DEFAULT 'LEGACY'::"text" NOT NULL,
    CONSTRAINT "competitors_tracking_location_check" CHECK ((("tracking_location" = 'LEGACY'::"text") OR ("tracking_location" = 'GLOBAL'::"text") OR ("tracking_location" ~ '^[A-Z]{2}$'::"text")))
);


ALTER TABLE "public"."competitors" OWNER TO "postgres";


COMMENT ON COLUMN "public"."competitors"."tracking_location" IS 'Country code or GLOBAL for the originating tracking data; LEGACY means location was not reliably recorded.';



CREATE TABLE IF NOT EXISTS "public"."direct_competitor_observations" (
    "competitor_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "metric_date" "date" NOT NULL,
    "tracking_location" "text" DEFAULT 'LEGACY'::"text" NOT NULL,
    "llm_provider" "text" DEFAULT 'chatgpt'::"text" NOT NULL,
    "presence_count" integer DEFAULT 0 NOT NULL,
    "response_count" integer DEFAULT 0 NOT NULL,
    "citation_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "direct_competitor_observations_citation_count_check" CHECK (("citation_count" >= 0)),
    CONSTRAINT "direct_competitor_observations_presence_count_check" CHECK (("presence_count" >= 0)),
    CONSTRAINT "direct_competitor_observations_response_count_check" CHECK (("response_count" >= 0))
);


ALTER TABLE "public"."direct_competitor_observations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."direct_competitors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "normalized_domain" "text" NOT NULL,
    "brand_name" "text" NOT NULL,
    "website" "text",
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "first_seen_date" "date" NOT NULL,
    "last_seen_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."direct_competitors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."llm_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "api_key_encrypted" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "api_key_secret_id" "uuid",
    "api_key_last4" "text",
    "key_updated_at" timestamp with time zone,
    CONSTRAINT "llm_configs_provider_check" CHECK (("provider" = ANY (ARRAY['chatgpt'::"text", 'gemini'::"text", 'perplexity'::"text", 'google_ai_overview'::"text", 'claude'::"text"])))
);


ALTER TABLE "public"."llm_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."llm_secrets" (
    "project_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "ciphertext" "text" NOT NULL,
    "key_last4" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "llm_secrets_provider_check" CHECK (("provider" = ANY (ARRAY['chatgpt'::"text", 'gemini'::"text", 'perplexity'::"text", 'google_ai_overview'::"text", 'claude'::"text"])))
);


ALTER TABLE "public"."llm_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."metric_definitions" (
    "metric_key" "text" NOT NULL,
    "version" "text" NOT NULL,
    "label" "text" NOT NULL,
    "unit" "text" NOT NULL,
    "definition" "text" NOT NULL,
    "numerator" "text",
    "denominator" "text",
    "scope" "text" NOT NULL,
    "tie_policy" "text",
    "missing_data_policy" "text",
    "is_current" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."metric_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "role" "public"."app_role" DEFAULT 'viewer'::"public"."app_role" NOT NULL,
    "is_permanent" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ui_preferences" "jsonb" DEFAULT '{"scale": 100, "theme": "light", "text_size": 100}'::"jsonb" NOT NULL,
    "email" "text"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" DEFAULT 'viewer'::"public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_name" "text" NOT NULL,
    "brand_description" "text",
    "brand_logo_url" "text",
    "brand_terms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "brand_domains" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "categories" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "tracking_market" "text" DEFAULT 'MY'::"text" NOT NULL,
    "tracking_locations" "text"[] DEFAULT ARRAY['MY'::"text"] NOT NULL,
    "brand_profile" "jsonb",
    "brand_profile_updated_at" timestamp with time zone,
    CONSTRAINT "projects_tracking_locations_check" CHECK ((("cardinality"("tracking_locations") = 1) AND (("tracking_locations" = ARRAY['GLOBAL'::"text"]) OR ("tracking_locations"[1] ~ '^[A-Z]{2}$'::"text")))),
    CONSTRAINT "projects_tracking_market_check" CHECK ((("tracking_market" = 'GLOBAL'::"text") OR ("tracking_market" ~ '^[A-Z]{2}$'::"text")))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


COMMENT ON COLUMN "public"."projects"."tracking_market" IS 'AI visibility search market for this brand project: GLOBAL or an ISO 3166-1 alpha-2 country code.';



COMMENT ON COLUMN "public"."projects"."tracking_locations" IS 'Exactly one selected tracking location: an ISO alpha-2 country code or GLOBAL.';



CREATE TABLE IF NOT EXISTS "public"."prompts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "prompt_number" smallint NOT NULL,
    "prompt" "text" NOT NULL,
    "category" "text" NOT NULL,
    "language" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prompts_prompt_number_check" CHECK ((("prompt_number" >= 1) AND ("prompt_number" <= 50)))
);


ALTER TABLE "public"."prompts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompts_backup_20261101" (
    "id" "uuid",
    "project_id" "uuid",
    "prompt_number" smallint,
    "prompt" "text",
    "category" "text",
    "language" "text",
    "active" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."prompts_backup_20261101" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."response_brand_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "response_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "match_source" "text" NOT NULL,
    "matched_value" "text" NOT NULL,
    "evidence_text" "text",
    "first_position" integer,
    "occurrence_count" integer DEFAULT 1 NOT NULL,
    "confidence" "text" DEFAULT 'deterministic'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "response_brand_evidence_confidence_check" CHECK (("confidence" = ANY (ARRAY['deterministic'::"text", 'review_required'::"text", 'verified'::"text"]))),
    CONSTRAINT "response_brand_evidence_match_source_check" CHECK (("match_source" = ANY (ARRAY['response_text'::"text", 'citation_domain'::"text", 'research_source'::"text", 'mentioned_url'::"text"]))),
    CONSTRAINT "response_brand_evidence_occurrence_count_check" CHECK (("occurrence_count" >= 0))
);


ALTER TABLE "public"."response_brand_evidence" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."response_brand_evidence_scoped" AS
 SELECT "e"."id" AS "evidence_id",
    "e"."response_id",
    "e"."project_id",
    "e"."brand_id" AS "entity_id",
    "e"."category",
    ("timezone"('Asia/Kuala_Lumpur'::"text", "r"."captured_at"))::"date" AS "metric_date",
    "r"."llm_provider" AS "provider",
    "r"."tracking_location",
    "r"."run_id",
    "e"."match_source" AS "evidence_type",
    "e"."matched_value",
    "e"."evidence_text",
    "e"."first_position",
    "e"."occurrence_count",
    "e"."confidence",
    "r"."response_status"
   FROM ("public"."response_brand_evidence" "e"
     JOIN "public"."ai_responses" "r" ON ((("r"."id" = "e"."response_id") AND ("r"."project_id" = "e"."project_id"))));