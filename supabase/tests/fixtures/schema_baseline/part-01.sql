


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


-- pg_cron omitted: not required for replacement-rerun DB tests.

CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."app_role" AS ENUM (
    'superadmin',
    'admin',
    'viewer'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."alias_match_pattern"("terms" "text"[]) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case when count(*) = 0 then null
    else '(?<![A-Za-z0-9])(?:' || string_agg(p, '|' order by len desc, p) || ')(?![A-Za-z0-9])' end
  from (
    select q.p, length(s.t) as len
    from (select distinct btrim(t) as t from unnest(terms) t where length(btrim(t)) > 1) s
    cross join lateral (
      select nullif(array_to_string(array(
        select tok from regexp_split_to_table(s.t, '[^A-Za-z0-9]+') tok where tok <> ''
      ), '[^A-Za-z0-9]+'), '') as p
    ) q
    where q.p is not null
  ) z
$$;


ALTER FUNCTION "public"."alias_match_pattern"("terms" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_reports_guard_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and (to_jsonb(new) - 'edits' - 'updated_at') is distinct from (to_jsonb(old) - 'edits' - 'updated_at') then
    raise exception 'Only report edits can be changed.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."audit_reports_guard_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backfill_verified_category_runs"() RETURNS TABLE("run_id" "uuid", "category" "text", "metric_date" "date", "outcome" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  c record;
  v_expected integer;
  v_obs integer;
begin
  for c in
    select * from (
      select tr.id, tr.project_id, tr.provider, tr.tracking_location, tr.completed_at,
             tr.total_prompts, tr.completed_prompts,
             st.metadata->>'topic' as stage_category,
             (tr.started_at at time zone 'Asia/Kuala_Lumpur')::date as d,
             row_number() over (
               partition by tr.project_id, (tr.started_at at time zone 'Asia/Kuala_Lumpur')::date,
                            st.metadata->>'topic', tr.provider, tr.tracking_location
               order by tr.completed_at desc nulls last, tr.id desc) as rn
      from public.tracking_runs tr
      join public.tracking_run_stages st on st.run_id = tr.id and st.stage_key = 'category_cleanup'
      join public.projects p on p.id = tr.project_id
      where tr.category is null and tr.status = 'completed' and tr.completed_at is not null
        and tr.published_at is null and tr.total_prompts = tr.completed_prompts
        and st.status = 'completed' and st.metadata->>'category_scoped' = 'true'
        and st.metadata->>'topic' = any(p.categories)
    ) x where x.rn = 1
    order by x.d, x.completed_at
  loop
    run_id := c.id; category := c.stage_category; metric_date := c.d;
    begin
      if exists (select 1 from public.tracking_run_stages s where s.run_id = c.id and s.status <> 'completed') then
        raise exception 'stage journal incomplete';
      end if;
      if (select count(*) from public.ai_responses ar where ar.run_id = c.id and ar.response_status = 'completed') <> c.completed_prompts
         or (select count(*) from public.ai_responses ar where ar.run_id = c.id) <> c.total_prompts then
        raise exception 'stored responses do not match prompt counts';
      end if;

      select count(*) into v_expected from public.category_brand_assignments a
      where a.project_id = c.project_id and a.category = c.stage_category and a.role = 'competitor' and a.include_in_metrics;
      select count(distinct o.brand_id) into v_obs from public.category_brand_observations o
      where o.project_id = c.project_id and o.metric_date = c.d and o.category = c.stage_category
        and o.llm_provider = c.provider and o.tracking_location = c.tracking_location and o.run_id is null;
      if v_obs <> v_expected or v_obs = 0 then
        raise exception 'competitor observations (%) do not match registered competitors (%)', v_obs, v_expected;
      end if;

      update public.tracking_runs set category = c.stage_category, run_kind = 'topic' where id = c.id;
      update public.category_brand_observations o set run_id = c.id
      where o.project_id = c.project_id and o.metric_date = c.d and o.category = c.stage_category
        and o.llm_provider = c.provider and o.tracking_location = c.tracking_location and o.run_id is null;
      update public.visibility_daily v set run_id = c.id
      where v.project_id = c.project_id and v.metric_date = c.d and v.category = c.stage_category
        and v.tracking_location = c.tracking_location and v.run_id is null
        and v.llm_provider in ('chatgpt', 'Overall');

      update public.tracking_runs set published_at = c.completed_at where id = c.id;
      outcome := 'published';
      return next;
    exception when others then
      outcome := 'skipped: ' || sqlerrm;
      return next;
    end;
  end loop;
end;
$$;


ALTER FUNCTION "public"."backfill_verified_category_runs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_profound_third_party_mentions"("p_project_id" "uuid", "p_date_from" "date", "p_date_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '10min'
    AS $_$
declare
  v_project public.projects%rowtype;
  v_rows integer;
  v_old_third integer;
  v_old_occ integer;
  v_stale_citations integer;
begin
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'project % not found', p_project_id; end if;

  -- Brand aliases per category assignment (same alias sources the tracking run uses to relate a source to a brand).
  create temp table _tp_brands on commit drop as
  select a.category, b.id as brand_id, b.canonical_name,
         public.alias_match_pattern(array(
           select distinct btrim(x) from unnest(
             array[b.canonical_name] || coalesce(b.aliases, '{}') || coalesce(a.aliases, '{}')
             || case when a.role = 'tracked_brand' then coalesce(v_project.brand_terms, '{}') else '{}'::text[] end) x
           where length(btrim(x)) > 1)) as pattern
  from public.category_brand_assignments a
  join public.brand_registry b on b.id = a.brand_id and b.is_active
  where a.project_id = p_project_id and a.include_in_metrics;

  -- Cited pages of the imported responses (one row per response and canonical URL).
  create temp table _tp_src on commit drop as
  select distinct on (x.response_id, x.canonical_url)
         x.response_id, x.provider, x.loc, x.d, x.category, x.url, x.title, x.canonical_url, x.host
  from (
    select ar.id as response_id, ar.llm_provider as provider, ar.tracking_location as loc,
           (ar.captured_at at time zone 'Asia/Kuala_Lumpur')::date as d, pr.category,
           (an ->> 'url') as url, coalesce(nullif(an ->> 'title', ''), '') as title,
           public.canonicalize_citation_url(an ->> 'url') as canonical_url,
           regexp_replace(lower(split_part(split_part(regexp_replace(an ->> 'url', '^https?://', '', 'i'), '/', 1), ':', 1)), '^www[.]', '') as host
    from public.ai_responses ar
    join public.prompts pr on pr.id = ar.prompt_id
    cross join lateral jsonb_path_query(ar.raw_response, '$.output[*].content[*].annotations[*] ? (@.type == "url_citation")') an
    where ar.project_id = p_project_id and ar.data_source = 'profound_import' and ar.response_status = 'completed'
      and (ar.captured_at at time zone 'Asia/Kuala_Lumpur')::date between p_date_from and p_date_to
      and (an ->> 'url') ~* '^https?://'
  ) x
  where x.host <> ''
  order by x.response_id, x.canonical_url, x.url;

  -- Brands whose name or alias appears in the page title or URL (direct evidence).
  create temp table _tp_direct on commit drop as
  select s.response_id, s.canonical_url, array_agg(distinct b.brand_id) as ids
  from _tp_src s
  join _tp_brands b on b.category = s.category and b.pattern is not null and lower(s.title || ' ' || s.url) ~* b.pattern
  group by s.response_id, s.canonical_url;

  -- Brands named in the same answer (inferred association when the page itself names no brand).
  create temp table _tp_answer on commit drop as
  select e.response_id, array_agg(distinct e.brand_id) as ids
  from public.response_brand_evidence e
  where e.match_source = 'response_text' and e.response_id in (select response_id from _tp_src)
  group by e.response_id;

  -- Replace what the retired platform runs had recorded for these engine days.
  create temp table _tp_retired on commit drop as
  select ar.id from public.ai_responses ar
  join public.tracking_runs r on r.id = ar.run_id
  where ar.project_id = p_project_id and r.data_source is null and (r.superseded_at is not null or r.published_at is null)
    and (ar.captured_at at time zone 'Asia/Kuala_Lumpur')::date between p_date_from and p_date_to
    and exists (select 1 from _tp_src s where s.d = (ar.captured_at at time zone 'Asia/Kuala_Lumpur')::date and s.provider = ar.llm_provider)
    and r.run_kind in ('topic', 'full');

  delete from public.third_party_mentions t
  where t.project_id = p_project_id and (t.response_id in (select id from _tp_retired)
        or (t.response_id in (select response_id from _tp_src)));
  get diagnostics v_old_third = row_count;

  delete from public.citation_occurrences c where c.project_id = p_project_id and c.response_id in (select id from _tp_retired);
  get diagnostics v_old_occ = row_count;

  -- Citations rows that only the retired platform runs produced for these engine days.
  delete from public.citations c
  where c.project_id = p_project_id and c.metric_date between p_date_from and p_date_to
    and exists (select 1 from _tp_src s where s.d = c.metric_date and s.provider = c.llm_provider and s.category = c.category)
    and not exists (select 1 from _tp_src s where s.d = c.metric_date and s.provider = c.llm_provider and s.category = c.category and s.url = c.url);
  get diagnostics v_stale_citations = row_count;

  insert into public.third_party_mentions (
    project_id, response_id, metric_date, category, llm_provider, tracking_location, url, canonical_url, hostname, website_name,
    source_type, associated_brand_ids, associated_brand_names, association_status, frequency)
  select p_project_id, s.response_id, s.d, s.category, s.provider, s.loc, s.url, s.canonical_url, s.host,
         coalesce(nullif(s.title, ''), replace(replace(regexp_replace(s.host, '[.][^.]+$', ''), '-', ' '), '_', ' ')),
         'citation_annotation', rel.ids,
         array(select br.canonical_name from public.brand_registry br where br.id = any(rel.ids) order by br.canonical_name),
         'inferred', 1
  from _tp_src s
  left join _tp_direct d on d.response_id = s.response_id and d.canonical_url = s.canonical_url
  left join _tp_answer a on a.response_id = s.response_id
  cross join lateral (select coalesce(d.ids, a.ids) as ids) rel
  where coalesce(cardinality(rel.ids), 0) > 0
  on conflict (project_id, response_id, canonical_url, source_type, category, tracking_location) do update set
    associated_brand_ids = excluded.associated_brand_ids, associated_brand_names = excluded.associated_brand_names,
    website_name = excluded.website_name;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('third_party_rows', v_rows, 'replaced_third_party_rows', v_old_third,
    'removed_retired_citation_occurrences', v_old_occ, 'removed_stale_citations', v_stale_citations,
    'cited_pages_seen', (select count(*) from _tp_src));
end;
$_$;


ALTER FUNCTION "public"."build_profound_third_party_mentions"("p_project_id" "uuid", "p_date_from" "date", "p_date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_edit_project"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select public.is_superadmin() or exists(select 1 from public.project_members pm where pm.project_id=p_project_id and pm.user_id=auth.uid() and pm.role in ('admin','superadmin')) or exists(select 1 from public.projects p where p.id=p_project_id and p.created_by=auth.uid() and public.current_app_role()='admin') $$;


ALTER FUNCTION "public"."can_edit_project"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_project_members"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_superadmin()
    or exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id and pm.user_id = auth.uid()
        and pm.role in ('admin', 'superadmin')
    )
    or exists (
      select 1 from public.projects p
      where p.id = p_project_id and p.created_by = auth.uid()
        and public.current_app_role() = 'admin'
    )
$$;


ALTER FUNCTION "public"."can_manage_project_members"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."canonical_scoped_rank"("p_project_id" "uuid", "p_run_id" "uuid", "p_category" "text", "p_metric_date" "date", "p_provider" "text", "p_location" "text", "p_tracked_presence" integer, "p_tracked_responses" integer) RETURNS TABLE("visibility_rank" integer, "rank_population_count" integer, "rank_population_status" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with comp as (
    select o.presence_count, o.response_count
    from public.category_brand_observations o
    where o.project_id = p_project_id and o.run_id = p_run_id and o.category = p_category
      and o.metric_date = p_metric_date and o.llm_provider = p_provider
      and o.tracking_location = p_location and o.response_count > 0
      and exists (
        select 1 from public.category_brand_assignments a
        where a.project_id = p_project_id and a.brand_id = o.brand_id and a.role = 'competitor'
          and a.include_in_metrics and (p_category = 'Overall' or a.category = p_category))
  )
  select
    case when coalesce(p_tracked_responses, 0) = 0 or not exists (select 1 from comp) then null
         else 1 + (select count(*) from comp c
                   where c.presence_count::numeric * p_tracked_responses > p_tracked_presence::numeric * c.response_count)::integer
    end,
    case when coalesce(p_tracked_responses, 0) = 0 or not exists (select 1 from comp) then 0
         else (select count(*) from comp)::integer + 1 end,
    case when coalesce(p_tracked_responses, 0) = 0 or not exists (select 1 from comp)
         then 'no_eligible_observations' else 'verified' end;
$$;


ALTER FUNCTION "public"."canonical_scoped_rank"("p_project_id" "uuid", "p_run_id" "uuid", "p_category" "text", "p_metric_date" "date", "p_provider" "text", "p_location" "text", "p_tracked_presence" integer, "p_tracked_responses" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."canonicalize_citation_url"("input_url" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  without_fragment text;
  base_url text;
  query_string text;
  kept_params text[];
  item text;
  param_key text;
  normalized_base text;
BEGIN
  IF input_url IS NULL OR btrim(input_url) = '' THEN
    RETURN input_url;
  END IF;

  without_fragment := split_part(input_url, '#', 1);
  base_url := split_part(without_fragment, '?', 1);
  query_string := CASE WHEN position('?' IN without_fragment) > 0
    THEN substring(without_fragment FROM position('?' IN without_fragment) + 1)
    ELSE '' END;

  normalized_base := regexp_replace(base_url, '^http://', 'https://', 'i');
  normalized_base := regexp_replace(normalized_base, '^https://www\.', 'https://', 'i');
  normalized_base := regexp_replace(normalized_base, '/+$', '');
  kept_params := ARRAY[]::text[];

  IF query_string <> '' THEN
    FOREACH item IN ARRAY string_to_array(query_string, '&') LOOP
      param_key := lower(split_part(item, '=', 1));
      IF item <> '' AND param_key !~ '^utm_' AND param_key NOT IN (
        'gclid', 'dclid', 'fbclid', 'msclkid', 'yclid', '_ga', '_gl',
        'ref', 'source', 'campaign', 'mc_cid', 'mc_eid'
      ) THEN
        kept_params := array_append(kept_params, item);
      END IF;
    END LOOP;
  END IF;

  IF cardinality(kept_params) > 0 THEN
    SELECT array_agg(value ORDER BY lower(split_part(value, '=', 1)), value)
    INTO kept_params FROM unnest(kept_params) AS value;
    RETURN normalized_base || '?' || array_to_string(kept_params, '&');
  END IF;

  RETURN normalized_base;
END;
$_$;


ALTER FUNCTION "public"."canonicalize_citation_url"("input_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_metric_integrity"("p_project_id" "uuid" DEFAULT NULL::"uuid", "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS TABLE("check_name" "text", "severity" "text", "project_id" "uuid", "metric_date" "date", "category" "text", "detail" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with vd as (
    select v.*, tr.provider as run_provider, tr.status as run_status, tr.published_at as run_published_at, tr.run_kind
    from public.visibility_daily v
    left join public.tracking_runs tr on tr.id = v.run_id
    where v.llm_provider = 'Overall'
      and (p_project_id is null or v.project_id = p_project_id)
      and (p_start_date is null or v.metric_date >= p_start_date)
      and (p_end_date is null or v.metric_date <= p_end_date)
  )
  select 'tracked_score_matches_evidence'::text, 'error'::text, v.project_id, v.metric_date, v.category,
    format('stored %s vs %s/%s = %s', v.visibility_score, t.presence_count, t.response_count,
           round(t.presence_count::numeric / nullif(t.response_count, 0) * 100, 1))
  from vd v cross join lateral public.run_tracked_presence(v.run_id, v.category) t
  where v.run_id is not null and v.run_kind in ('topic', 'full') and t.response_count > 0
    and abs(round(t.presence_count::numeric / t.response_count * 100, 1) - v.visibility_score) > 0.05
  union all
  select 'rank_matches_canonical', 'error', v.project_id, v.metric_date, v.category,
    format('stored %s/%s vs canonical %s/%s', v.visibility_rank, v.rank_population_count, k.visibility_rank, k.rank_population_count)
  from vd v
  cross join lateral public.canonical_scoped_rank(v.project_id, v.run_id, v.category, v.metric_date,
       coalesce(v.run_provider, 'chatgpt'), v.tracking_location, v.presence_count, v.response_count) k
  where v.run_id is not null and v.presence_count is not null
    and (v.visibility_rank is distinct from k.visibility_rank or v.rank_population_count is distinct from k.rank_population_count)
  union all
  select 'rank_population_unverified', 'warning', v.project_id, v.metric_date, v.category,
    'rank population is unverified (legacy lineage); excluded from verified comparisons'
  from vd v where v.rank_population_status = 'unverified' and v.visibility_rank is not null
  union all
  select 'competitor_coverage_incomplete', 'warning', v.project_id, v.metric_date, v.category,
    format('%s of %s registered competitors have valid observations', c.observed, c.expected)
  from vd v
  cross join lateral (
    select max(o.expected_competitor_count) expected, max(o.observed_competitor_count) observed
    from public.get_published_competitor_observations(v.project_id, v.metric_date, v.category,
         coalesce(v.run_provider, 'chatgpt'), v.tracking_location) o
  ) c
  where v.run_id is not null and v.run_published_at is not null and c.observed < c.expected
  union all
  select 'citation_count_matches_occurrences', 'error', v.project_id, v.metric_date, v.category,
    format('daily %s vs published-run occurrences %s', v.citation_count, occ.n)
  from vd v
  cross join lateral (
    select count(*)::integer n from public.citation_occurrences co
    join public.brand_registry b on b.id = co.entity_id and b.is_tracked_brand
    where co.project_id = v.project_id and co.metric_date = v.metric_date
      and co.tracking_location = v.tracking_location and (v.category = 'Overall' or co.category = v.category)
      and co.run_id in (select coalesce(t.source_run_id, t.id) from public.tracking_runs t
                        where t.id = any(coalesce(v.source_run_ids, array[v.run_id])))
  ) occ
  where v.run_id is not null and v.metric_version is not null and v.run_kind in ('topic', 'overall_aggregate')
    and v.citation_count <> occ.n
  union all
  select 'citation_occurrences_from_unpublished_runs', 'warning', co.project_id, co.metric_date, co.category,
    format('%s occurrence rows belong to runs that are not the published run (retained for audit, excluded by latest-response selection)', count(*))
  from public.citation_occurrences co
  join public.tracking_runs tr on tr.id = co.run_id
  where (tr.published_at is null or tr.superseded_at is not null)
    and (p_project_id is null or co.project_id = p_project_id)
    and (p_start_date is null or co.metric_date >= p_start_date) and (p_end_date is null or co.metric_date <= p_end_date)
  group by co.project_id, co.metric_date, co.category
  union all
  select 'daily_metric_without_published_run', 'error', v.project_id, v.metric_date, v.category,
    'visibility_daily row references a run that is not published'
  from vd v where v.run_id is not null and (v.run_published_at is null or v.run_status <> 'completed')
  union all
  select 'competitor_observations_without_run', 'warning', o.project_id, o.metric_date, o.category,
    format('%s observation rows have no run lineage', count(*))
  from public.category_brand_observations o
  where o.run_id is null and (p_project_id is null or o.project_id = p_project_id)
    and (p_start_date is null or o.metric_date >= p_start_date) and (p_end_date is null or o.metric_date <= p_end_date)
  group by o.project_id, o.metric_date, o.category
  union all
  select 'competitor_stats_out_of_date', 'warning', o.project_id, o.metric_date, o.category,
    format('%s observation rows belong to brands that are no longer assigned as competitors; a recompute is pending', count(*))
  from public.category_brand_observations o
  join public.tracking_runs tr on tr.id = o.run_id and tr.published_at is not null and tr.superseded_at is null
  where o.category <> 'Overall' and (p_project_id is null or o.project_id = p_project_id)
    and (p_start_date is null or o.metric_date >= p_start_date) and (p_end_date is null or o.metric_date <= p_end_date)
    and not exists (select 1 from public.category_brand_assignments a
                    where a.project_id = o.project_id and a.brand_id = o.brand_id and a.category = o.category
                      and a.role = 'competitor' and a.include_in_metrics)
  group by o.project_id, o.metric_date, o.category
  union all
  select 'duplicate_evidence', 'error', d.project_id, null::date, d.category, format('%s duplicated evidence keys', count(*))
  from (select e.project_id, e.category, e.response_id, e.brand_id, e.match_source, e.matched_value
        from public.response_brand_evidence e group by 1,2,3,4,5,6 having count(*) > 1) d
  group by d.project_id, d.category;
$$;


ALTER FUNCTION "public"."check_metric_integrity"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_daily_tracking_run"("p_project_id" "uuid", "p_started_by" "uuid", "p_run_id" "uuid", "p_total_prompts" integer) RETURNS TABLE("claimed" boolean, "run_id" "uuid", "status" "text", "started_at" timestamp with time zone, "run_date" "date")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_inserted_run_id uuid;
  v_existing_run_id uuid;
  v_existing_started_at timestamptz;
  v_existing_status text;
BEGIN
  IF p_total_prompts IS NULL OR p_total_prompts < 1 THEN
    RAISE EXCEPTION 'p_total_prompts must be positive';
  END IF;

  INSERT INTO public.tracking_runs (
    id, project_id, started_by, provider, status,
    total_prompts, completed_prompts, failed_prompts, started_at
  )
  VALUES (
    p_run_id, p_project_id, p_started_by, 'chatgpt', 'running',
    p_total_prompts, 0, 0, now()
  );

  INSERT INTO public.tracking_run_daily_claims (project_id, run_date, run_id, started_by)
  VALUES (p_project_id, v_date, p_run_id, p_started_by)
  ON CONFLICT ON CONSTRAINT tracking_run_daily_claims_pkey DO NOTHING
  RETURNING tracking_run_daily_claims.run_id INTO v_inserted_run_id;

  IF v_inserted_run_id IS NOT NULL THEN
    RETURN QUERY SELECT true, p_run_id, 'running'::text, now(), v_date;
    RETURN;
  END IF;

  DELETE FROM public.tracking_runs WHERE id = p_run_id;

  SELECT c.run_id, c.created_at, tr.status
    INTO v_existing_run_id, v_existing_started_at, v_existing_status
  FROM public.tracking_run_daily_claims c
  LEFT JOIN public.tracking_runs tr ON tr.id = c.run_id
  WHERE c.project_id = p_project_id AND c.run_date = v_date;

  RETURN QUERY SELECT false, v_existing_run_id, coalesce(v_existing_status, 'unknown'), v_existing_started_at, v_date;
END;
$$;


ALTER FUNCTION "public"."claim_daily_tracking_run"("p_project_id" "uuid", "p_started_by" "uuid", "p_run_id" "uuid", "p_total_prompts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."client_reports_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."client_reports_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."competitor_assignment_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare changed boolean := false;
begin
  if tg_op = 'DELETE' then
    if old.role = 'competitor' then
      insert into public.category_brand_assignments_archive select old.*, now(), 'deleted';
      perform public.enqueue_competitor_recompute(old.project_id);
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    changed := (old.role, old.include_in_metrics, old.category, old.brand_id, old.aliases, old.websites)
               is distinct from (new.role, new.include_in_metrics, new.category, new.brand_id, new.aliases, new.websites);
    if changed and (old.role = 'competitor' or new.role = 'competitor') then
      insert into public.category_brand_assignments_archive select old.*, now(), 'updated';
      perform public.enqueue_competitor_recompute(new.project_id);
    end if;
    return new;
  else
    if new.role = 'competitor' then perform public.enqueue_competitor_recompute(new.project_id); end if;
    return new;
  end if;
end;
$$;


ALTER FUNCTION "public"."competitor_assignment_changed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."competitor_entities"("p_project_id" "uuid") RETURNS TABLE("category" "text", "brand_id" "uuid", "canonical_name" "text", "websites" "text"[], "aliases" "text"[], "pattern" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with base as (
    select a.category, b.id as brand_id, b.canonical_name,
      array(select distinct public.site_host(w) from unnest(
        coalesce(a.websites, '{}') || array[b.primary_website] || coalesce(b.additional_websites, '{}')) w
        where public.site_host(w) is not null) as websites,
      coalesce(b.aliases, '{}') as b_aliases, coalesce(a.aliases, '{}') as a_aliases
    from public.category_brand_assignments a
    join public.brand_registry b on b.id = a.brand_id and b.is_active
    where a.project_id = p_project_id and a.role = 'competitor' and a.include_in_metrics
  )
  select base.category, base.brand_id, base.canonical_name, base.websites, q.al, public.alias_match_pattern(q.al)
  from base
  cross join lateral (
    select array(select distinct btrim(v) from unnest(
      array[base.canonical_name] || base.b_aliases || base.a_aliases || base.websites
      || array(select regexp_replace(split_part(w, '.', 1), '[-_]+', ' ', 'g') from unnest(base.websites) w)) v
      where length(btrim(v)) > 1) as al
  ) q;
$$;


ALTER FUNCTION "public"."competitor_entities"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."competitor_registry_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if (old.canonical_name, old.aliases, old.primary_website, old.additional_websites, old.is_active)
     is distinct from (new.canonical_name, new.aliases, new.primary_website, new.additional_websites, new.is_active)
     and exists (select 1 from public.category_brand_assignments a
                 where a.brand_id = new.id and a.role = 'competitor' and a.include_in_metrics) then
    perform public.enqueue_competitor_recompute(new.project_id);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."competitor_registry_changed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_app_role"() RETURNS "public"."app_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select role from public.profiles where id = auth.uid() $$;


ALTER FUNCTION "public"."current_app_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_competitor_recompute"("p_project_id" "uuid", "p_reason" "text" DEFAULT 'competitor_set_changed'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_id uuid;
begin
  insert into public.competitor_recompute_jobs (project_id, reason, requested_by)
  values (p_project_id, p_reason, auth.uid())
  on conflict (project_id) where status = 'queued' do update set requested_at = now(), reason = excluded.reason
  returning id into v_id;
  return v_id;
end;
$$;


ALTER FUNCTION "public"."enqueue_competitor_recompute"("p_project_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_run_metrics"("p_run_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    select id, category, metric_date, visibility_score
    from public.visibility_daily where run_id = p_run_id
  loop
    select t.presence_count, t.response_count into v_pres, v_resp
    from public.run_tracked_presence(p_run_id, r.category) t;

    if coalesce(v_resp, 0) > 0
       and r.visibility_score is not null
       and abs(round(v_pres::numeric / v_resp * 100, 1) - r.visibility_score) > 0.05 then
      raise exception 'PUBLICATION_BLOCKED: stored visibility % for % on % does not match % of % valid responses (run %)',
        r.visibility_score, r.category, r.metric_date, v_pres, v_resp, p_run_id;
    end if;

    select * into v_rank from public.canonical_scoped_rank(
      v_run.project_id, p_run_id, r.category, r.metric_date, v_run.provider, v_run.tracking_location, v_pres, v_resp);

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


ALTER FUNCTION "public"."finalize_run_metrics"("p_run_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_competitor_counts_for_period"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text" DEFAULT NULL::"text") RETURNS TABLE("category" "text", "metric_date" "date", "competitor_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location,p.tracking_market,'LEGACY') AS location
    FROM public.projects p WHERE p.id=p_project_id
  ),
  latest AS (
    SELECT vd.category,max(vd.metric_date) AS metric_date
    FROM public.visibility_daily vd CROSS JOIN chosen_location cl
    WHERE vd.project_id=p_project_id AND vd.llm_provider='Overall'
      AND vd.tracking_location=cl.location
      AND vd.metric_date BETWEEN p_start_date AND p_end_date
    GROUP BY vd.category
  )
  SELECT l.category,l.metric_date,count(DISTINCT a.brand_id)::bigint AS competitor_count
  FROM latest l
  CROSS JOIN chosen_location cl
  LEFT JOIN public.category_brand_assignments a ON a.project_id=p_project_id
    AND a.include_in_metrics AND a.role='competitor'
    AND (l.category='Overall' OR a.category=l.category)
  GROUP BY l.category,l.metric_date
  ORDER BY l.category;
$$;


ALTER FUNCTION "public"."get_competitor_counts_for_period"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cumulative_citations"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text" DEFAULT NULL::"text", "p_engines" "text"[] DEFAULT '{}'::"text"[], "p_brand_related_only" boolean DEFAULT false, "p_tracking_location" "text" DEFAULT NULL::"text") RETURNS TABLE("url" "text", "page_name" "text", "brand_name" "text", "frequency" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "statement_timeout" TO '30s'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_project_member(p_project_id) THEN
    RAISE EXCEPTION 'Not authorized to access this project' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH normalized AS (
    SELECT c.url, c.page_name, c.brand_name, c.frequency,
           public.canonicalize_citation_url(c.url) AS canonical_url
    FROM public.citations c
    WHERE c.project_id = p_project_id
      AND c.metric_date BETWEEN p_start_date AND p_end_date
      AND c.tracking_location = coalesce(p_tracking_location, (
        SELECT p.tracking_market FROM public.projects p WHERE p.id = p_project_id
      ), 'LEGACY')
      AND (p_category IS NULL OR c.category = p_category)
      AND (coalesce(array_length(p_engines, 1), 0) = 0 OR c.llm_provider = ANY(p_engines))
      AND (NOT p_brand_related_only OR c.is_brand_related = true)
  )
  SELECT n.canonical_url, max(n.page_name), max(n.brand_name),
         sum(coalesce(n.frequency, 1))::bigint
  FROM normalized n
  GROUP BY n.canonical_url
  ORDER BY sum(coalesce(n.frequency, 1)) DESC, n.canonical_url ASC;
END;
$$;


ALTER FUNCTION "public"."get_cumulative_citations"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_brand_related_only" boolean, "p_tracking_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cumulative_competitors"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text" DEFAULT NULL::"text", "p_engines" "text"[] DEFAULT '{}'::"text"[], "p_tracking_location" "text" DEFAULT NULL::"text") RETURNS TABLE("brand_name" "text", "website" "text", "visibility_score" numeric, "citations" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH chosen_location AS (
    SELECT coalesce(p_tracking_location,p.tracking_market,'LEGACY') AS location
    FROM public.projects p WHERE p.id=p_project_id
  ),
  selected AS (
    SELECT o.brand_id,
      avg(100.0*o.presence_count/nullif(o.response_count,0))::numeric AS visibility_score,
      sum(o.citation_count)::bigint AS citations
    FROM public.category_brand_observations o
    CROSS JOIN chosen_location cl
    WHERE o.project_id=p_project_id AND o.metric_date BETWEEN p_start_date AND p_end_date
      AND o.tracking_location=cl.location
      AND o.category=coalesce(p_category,'Overall')
      AND (coalesce(array_length(p_engines,1),0)=0 OR o.llm_provider=ANY(p_engines))
    GROUP BY o.brand_id
  )
  SELECT b.canonical_name,
    CASE WHEN coalesce(b.primary_website,'')='' THEN NULL
      ELSE 'https://'||regexp_replace(regexp_replace(b.primary_website,'^https?://','','i'),'^www[.]','','i') END AS website,
    s.visibility_score,s.citations
  FROM selected s JOIN public.brand_registry b ON b.id=s.brand_id
  WHERE b.project_id=p_project_id AND b.is_active
    AND EXISTS (
      SELECT 1 FROM public.category_brand_assignments a
      WHERE a.project_id=b.project_id AND a.brand_id=b.id
        AND a.role='competitor' AND a.include_in_metrics
        AND (coalesce(p_category,'Overall')='Overall' OR a.category=p_category)
    )
  ORDER BY s.citations DESC,s.visibility_score DESC NULLS LAST,b.canonical_name;
$$;


ALTER FUNCTION "public"."get_cumulative_competitors"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_tracking_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_direct_competitor_metrics_for_period"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text" DEFAULT NULL::"text") RETURNS TABLE("category" "text", "metric_date" "date", "visibility_rank" integer, "competitor_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with chosen_location as (
    select coalesce(p_tracking_location, p.tracking_market, 'LEGACY') as location
    from public.projects p where p.id = p_project_id
  ),
  latest as (
    select vd.category, max(vd.metric_date) as metric_date
    from public.visibility_daily vd cross join chosen_location cl
    where vd.project_id = p_project_id and vd.llm_provider = 'Overall'
      and vd.tracking_location = cl.location
      and vd.metric_date between p_start_date and p_end_date
    group by vd.category
  ),
  brand_scores as (
    select vd.project_id, vd.category, vd.metric_date, vd.tracking_location,
      coalesce(vd.visibility_score, 0)::numeric as brand_score
    from public.visibility_daily vd join latest l on l.category=vd.category and l.metric_date=vd.metric_date
    cross join chosen_location cl
    where vd.project_id=p_project_id and vd.llm_provider='Overall' and vd.tracking_location=cl.location
  ),
  eligible_observations as (
    select dc.category, dc.normalized_domain, o.metric_date, o.tracking_location,
      o.llm_provider, o.presence_count, o.response_count
    from public.direct_competitors dc
    join public.direct_competitor_observations o on o.competitor_id=dc.id and o.project_id=dc.project_id
    cross join chosen_location cl
    join latest l on l.category=dc.category and l.metric_date=o.metric_date
    where dc.project_id=p_project_id and o.tracking_location=cl.location
      and o.llm_provider='chatgpt' and o.metric_date between p_start_date and p_end_date
      and o.response_count > 0
  ),
  scored as (
    select category, metric_date, tracking_location, normalized_domain,
      max(100.0 * presence_count / nullif(response_count,0))::numeric as competitor_score
    from eligible_observations
    group by category, metric_date, tracking_location, normalized_domain
  ),
  ranked as (
    select bs.category, bs.metric_date,
      count(distinct s.normalized_domain)::bigint as eligible_competitors,
      count(distinct s.normalized_domain) filter(where s.competitor_score > bs.brand_score)::bigint as competitors_above
    from brand_scores bs left join scored s on s.category=bs.category and s.metric_date=bs.metric_date and s.tracking_location=bs.tracking_location
    group by bs.category,bs.metric_date,bs.tracking_location,bs.brand_score
  )
  select r.category,r.metric_date,
    case when r.eligible_competitors=0 then null else (1+r.competitors_above)::integer end as visibility_rank,
    (r.eligible_competitors+1)::bigint as competitor_count
  from ranked r order by r.category;
$$;


ALTER FUNCTION "public"."get_direct_competitor_metrics_for_period"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_latest_competitor_counts"("p_project_id" "uuid", "p_tracking_location" "text" DEFAULT NULL::"text") RETURNS TABLE("category" "text", "metric_date" "date", "competitor_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT m.category, m.metric_date, m.competitor_count FROM public.get_direct_competitor_metrics_for_period(p_project_id, DATE '1900-01-01', (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date, p_tracking_location) m; $$;


ALTER FUNCTION "public"."get_latest_competitor_counts"("p_project_id" "uuid", "p_tracking_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_published_competitor_observations"("p_project_id" "uuid", "p_metric_date" "date", "p_category" "text", "p_provider" "text", "p_tracking_location" "text") RETURNS TABLE("published_run_id" "uuid", "published_at" timestamp with time zone, "run_status" "text", "expected_competitor_count" integer, "observed_competitor_count" integer, "coverage_status" "text", "brand_id" "uuid", "presence_count" integer, "response_count" integer, "mention_count" integer, "citation_count" integer, "average_position" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with canonical_run as (
    select tr.id, tr.published_at, tr.status from public.tracking_runs tr
    where tr.project_id = p_project_id and tr.provider = p_provider
      and tr.tracking_location = p_tracking_location and tr.status = 'completed'
      and tr.published_at is not null and tr.superseded_at is null
      and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
      and ((p_category = 'Overall' and tr.run_kind in ('overall_aggregate', 'full'))
        or (p_category <> 'Overall' and tr.run_kind = 'topic' and tr.category = p_category))
    order by tr.published_at desc, tr.id desc limit 1
  ), eligible as (
    select distinct tba.brand_id as id from public.category_brand_assignments tba
    where tba.project_id = p_project_id and tba.role = 'competitor' and tba.include_in_metrics = true
      and (p_category = 'Overall' or tba.category = p_category)
  ), scoped as (
    select o.* from public.category_brand_observations o
    join canonical_run cr on cr.id = o.run_id
    join eligible e on e.id = o.brand_id
    where o.project_id = p_project_id and o.metric_date = p_metric_date and o.category = p_category
      and o.llm_provider = p_provider and o.tracking_location = p_tracking_location and o.response_count > 0
  ), counts as (
    select (select count(*)::integer from eligible) expected,
           (select count(distinct brand_id)::integer from scoped) observed
  )
  select cr.id, cr.published_at, cr.status, counts.expected, counts.observed,
    case when counts.observed = 0 then 'missing_observations'
         when counts.observed < counts.expected then 'partial_coverage' else 'complete' end,
    s.brand_id, s.presence_count, s.response_count, s.mention_count, s.citation_count, s.average_position
  from canonical_run cr cross join counts left join scoped s on true
  union all
  select null::uuid, null::timestamptz, null::text, (select count(*)::integer from eligible), 0,
    'missing_published_run', null::uuid, null::integer, null::integer, null::integer, null::integer, null::numeric
  where not exists (select 1 from canonical_run);
$$;


ALTER FUNCTION "public"."get_published_competitor_observations"("p_project_id" "uuid", "p_metric_date" "date", "p_category" "text", "p_provider" "text", "p_tracking_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_published_run_ids_for_leaderboard"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_provider" "text", "p_tracking_location" "text") RETURNS TABLE("metric_date" "date", "run_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with scoped_runs as (
    select (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date as metric_date,
      tr.id as run_id,
      row_number() over (partition by (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date
                         order by tr.published_at desc, tr.id desc) as rn
    from public.tracking_runs tr
    where tr.project_id = p_project_id and public.is_project_member(p_project_id)
      and tr.provider = p_provider and tr.tracking_location = p_tracking_location
      and tr.status = 'completed' and tr.published_at is not null and tr.superseded_at is null
      and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date between p_start_date and p_end_date
      and ((p_category = 'Overall' and tr.run_kind in ('overall_aggregate', 'full'))
        or (p_category <> 'Overall' and tr.run_kind = 'topic' and tr.category = p_category))
  ) select sr.metric_date, sr.run_id from scoped_runs sr where sr.rn = 1;
$$;


ALTER FUNCTION "public"."get_published_run_ids_for_leaderboard"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_provider" "text", "p_tracking_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_report_prompt_gaps"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text", "p_limit" integer DEFAULT 10) RETURNS TABLE("prompt" "text", "category" "text", "competitors" "text"[])
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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