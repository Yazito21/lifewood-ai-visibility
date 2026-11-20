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
$$;


ALTER FUNCTION "public"."get_report_prompt_gaps"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_tracking_location" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_scoped_citation_occurrence_counts"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text" DEFAULT NULL::"text", "p_engines" "text"[] DEFAULT '{}'::"text"[], "p_tracking_location" "text" DEFAULT NULL::"text") RETURNS TABLE("entity_id" "uuid", "citation_occurrences" bigint, "unique_pages" bigint, "unique_domains" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with latest_responses as (
    select distinct on (
      r.project_id, (timezone('Asia/Kuala_Lumpur', r.captured_at))::date,
      p.category, r.llm_provider, r.tracking_location, r.prompt_id
    )
      r.id as response_id,
      r.project_id,
      (timezone('Asia/Kuala_Lumpur', r.captured_at))::date as metric_date,
      p.category,
      r.llm_provider as provider,
      r.tracking_location,
      r.prompt_id
    from public.ai_responses r
    join public.prompts p on p.id = r.prompt_id and p.project_id = r.project_id
    where r.project_id = p_project_id
      and r.response_status = 'completed'
      and (timezone('Asia/Kuala_Lumpur', r.captured_at))::date between p_start_date and p_end_date
      and r.tracking_location = coalesce(p_tracking_location, (select pr.tracking_market from public.projects pr where pr.id=p_project_id), 'LEGACY')
      and (p_category is null or p.category = p_category)
      and (coalesce(array_length(p_engines,1),0)=0 or r.llm_provider = any(p_engines))
    order by r.project_id, (timezone('Asia/Kuala_Lumpur', r.captured_at))::date,
      p.category, r.llm_provider, r.tracking_location, r.prompt_id, r.captured_at desc, r.id desc
  )
  select c.entity_id,
         count(*)::bigint,
         count(distinct c.canonical_url)::bigint,
         count(distinct c.canonical_domain)::bigint
  from public.citation_occurrences c
  join latest_responses lr on lr.response_id = c.response_id
    and lr.project_id = c.project_id
    and lr.metric_date = c.metric_date
    and lr.category = c.category
    and lr.provider = c.provider
    and lr.tracking_location = c.tracking_location
  group by c.entity_id;
$$;


ALTER FUNCTION "public"."get_scoped_citation_occurrence_counts"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_tracking_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_third_party_mentions"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text" DEFAULT NULL::"text", "p_engines" "text"[] DEFAULT '{}'::"text"[], "p_tracking_location" "text" DEFAULT NULL::"text") RETURNS TABLE("hostname" "text", "website_name" "text", "frequency" bigint, "response_frequency" bigint, "brand_coverage" bigint, "source_types" "text"[], "example_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '30s'
    AS $$
  WITH chosen_location AS MATERIALIZED (
    SELECT coalesce(p_tracking_location, p.tracking_market, 'LEGACY') AS location
    FROM public.projects p
    WHERE p.id = p_project_id
      AND (auth.role() = 'service_role' OR public.is_project_member(p.id))
  ),
  brand_hosts AS MATERIALIZED (
    SELECT DISTINCT
      CASE
        WHEN left(normalized.host, 4) = 'www.' THEN substring(normalized.host FROM 5)
        ELSE host
      END AS host
    FROM public.brand_registry b
    CROSS JOIN LATERAL unnest(
      coalesce(b.additional_websites, '{}'::text[])
      || ARRAY[coalesce(b.primary_website, '')]
    ) AS raw(raw_site)
    CROSS JOIN LATERAL (
      SELECT lower(split_part(split_part(
        regexp_replace(raw.raw_site, '^https?://', '', 'i'), '/', 1
      ), ':', 1)) AS host
    ) normalized
    WHERE b.project_id = p_project_id
      AND b.is_active
      AND normalized.host <> ''
  ),
  selected AS MATERIALIZED (
    SELECT t.*
    FROM public.third_party_mentions t
    JOIN chosen_location cl ON cl.location = t.tracking_location
    WHERE t.project_id = p_project_id
      AND t.metric_date BETWEEN p_start_date AND p_end_date
      AND (p_category IS NULL OR t.category = p_category)
      AND (coalesce(array_length(p_engines, 1), 0) = 0 OR t.llm_provider = ANY(p_engines))
      AND t.hostname <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM brand_hosts bh
        WHERE t.hostname = bh.host OR t.hostname LIKE '%.' || bh.host
      )
  )
  SELECT
    s.hostname,
    coalesce(max(s.website_name), s.hostname) AS website_name,
    sum(s.frequency)::bigint AS frequency,
    count(DISTINCT s.response_id)::bigint AS response_frequency,
    count(DISTINCT bid)::bigint AS brand_coverage,
    array_agg(DISTINCT s.source_type) AS source_types,
    (array_agg(s.url ORDER BY s.metric_date DESC))[1] AS example_url
  FROM selected s
  LEFT JOIN LATERAL unnest(s.associated_brand_ids) bid ON true
  GROUP BY s.hostname
  ORDER BY count(DISTINCT s.response_id) DESC, sum(s.frequency) DESC, s.hostname;
$$;


ALTER FUNCTION "public"."get_third_party_mentions"("p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_category" "text", "p_engines" "text"[], "p_tracking_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id,full_name,email,role,is_permanent)
  values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(coalesce(new.email,''),'@',1)),new.email,
    case when lower(coalesce(new.email,''))='aiman@lifewood.com' then 'superadmin'::public.app_role else 'viewer'::public.app_role end,
    lower(coalesce(new.email,''))='aiman@lifewood.com')
  on conflict(id) do update set email=excluded.email,updated_at=now();
  return new;
end;$$;


ALTER FUNCTION "public"."handle_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_profound_batch"("p_project_id" "uuid", "p_batch" "text", "p_replace_existing" boolean DEFAULT false, "p_presence_source" "text" DEFAULT 'profound'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '30min'
    AS $_$
declare
  v_project public.projects%rowtype;
  v_loc text;
  v_tracked_id uuid;
  v_tracked_name text;
  v_pattern text;
  v_unmatched integer;
  v_skipped jsonb;
  v_runs integer;
  v_resp integer;
  v_evidence integer;
  v_citations integer;
  v_dmin date;
  v_dmax date;
  v_engine jsonb;
begin
  if p_presence_source not in ('profound', 'text') then raise exception 'presence source must be profound or text'; end if;
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'project % not found', p_project_id; end if;
  v_loc := coalesce(v_project.tracking_market, 'GLOBAL');

  select b.id, b.canonical_name,
         public.alias_match_pattern(array_remove(
           array[v_project.brand_name, b.canonical_name, b.primary_website]
           || coalesce(b.aliases, '{}') || coalesce(v_project.brand_terms, '{}')
           || coalesce(v_project.brand_domains, '{}') || coalesce(b.additional_websites, '{}'), null))
  into v_tracked_id, v_tracked_name, v_pattern
  from public.brand_registry b
  where b.project_id = p_project_id and b.is_tracked_brand and b.is_active limit 1;
  if v_tracked_id is null or v_pattern is null then raise exception 'tracked brand not configured'; end if;

  if exists (select 1 from public.tracking_runs where project_id = p_project_id and data_source = 'profound_import' and import_batch = p_batch) then
    raise exception 'batch % has already been imported', p_batch;
  end if;

  create temp table _pi_prompts on commit drop as
  select pr.id, pr.category, lower(btrim(pr.prompt)) as k,
         row_number() over (partition by lower(btrim(pr.prompt)) order by pr.prompt_number, pr.id) as rk,
         count(*) over (partition by lower(btrim(pr.prompt))) as n
  from public.prompts pr where pr.project_id = p_project_id;

  create temp table _pi_rows on commit drop as
  select gen_random_uuid() as rid, s.id as sid, s.run_date, s.engine, s.response_status, s.response_text, s.cited_urls, s.meta,
         s.prompt, s.profound_mentioned as flagged, p.id as prompt_id, p.category
  from public.profound_import_rows s
  join _pi_prompts p on p.k = lower(btrim(s.prompt)) and p.rk = least(s.row_seq, p.n)
  where s.project_id = p_project_id and s.batch = p_batch;

  select count(*) into v_unmatched from public.profound_import_rows s
  where s.project_id = p_project_id and s.batch = p_batch and not exists (select 1 from _pi_rows r where r.sid = s.id);

  select coalesce(jsonb_agg(distinct jsonb_build_object('date', d.run_date, 'engine', d.engine)), '[]'::jsonb) into v_skipped
  from (select distinct r.run_date, r.engine from _pi_rows r
        where exists (select 1 from public.tracking_runs t
                      where t.project_id = p_project_id and t.provider = r.engine and t.tracking_location = v_loc
                        and t.run_kind = 'topic' and t.status = 'completed' and t.published_at is not null and t.superseded_at is null
                        and (t.published_at at time zone 'Asia/Kuala_Lumpur')::date = r.run_date)) d;
  if not p_replace_existing then
    delete from _pi_rows r
    where exists (select 1 from public.tracking_runs t
                  where t.project_id = p_project_id and t.provider = r.engine and t.tracking_location = v_loc
                    and t.run_kind = 'topic' and t.status = 'completed' and t.published_at is not null and t.superseded_at is null
                    and (t.published_at at time zone 'Asia/Kuala_Lumpur')::date = r.run_date);
  else
    v_skipped := '[]'::jsonb;
  end if;
  select min(run_date), max(run_date) into v_dmin, v_dmax from _pi_rows;
  if v_dmin is null then
    return jsonb_build_object('status', 'nothing_to_import', 'unmatched_rows', v_unmatched, 'skipped_engine_days', v_skipped);
  end if;

  -- Is the tracked brand present in the response? 'profound' follows Profound's own mentioned flag, 'text' the platform matcher.
  alter table _pi_rows add column present boolean;
  update _pi_rows r set present = case
    when r.response_status <> 'completed' then false
    when p_presence_source = 'profound' then coalesce(r.flagged, false)
    else r.response_text ~* v_pattern end;

  create temp table _pi_runs (id uuid, provider text, category text, run_date date) on commit drop;
  with ins as (
    insert into public.tracking_runs (
      project_id, provider, status, total_prompts, completed_prompts, failed_prompts, started_at, completed_at,
      tracking_location, category, run_kind, data_source, import_batch)
    select p_project_id, g.engine, 'completed', g.n, g.ok, g.n - g.ok,
           (g.run_date::text || ' 12:00:00+08')::timestamptz, (g.run_date::text || ' 12:00:00+08')::timestamptz,
           v_loc, g.category, 'topic', 'profound_import', p_batch
    from (select run_date, engine, category, count(*)::integer as n, (count(*) filter (where response_status = 'completed'))::integer as ok
          from _pi_rows group by run_date, engine, category) g
    returning id, provider, category, (started_at at time zone 'Asia/Kuala_Lumpur')::date as run_date
  ) insert into _pi_runs select * from ins;
  get diagnostics v_runs = row_count;
  alter table _pi_rows add column run_id uuid;
  update _pi_rows r set run_id = u.id from _pi_runs u where u.provider = r.engine and u.category = r.category and u.run_date = r.run_date;

  insert into public.ai_responses (
    id, project_id, prompt_id, llm_provider, captured_at, prompt_snapshot, raw_response, response_text, response_status,
    error_message, run_id, brand_name_snapshot, tracking_location, data_source)
  select r.rid, p_project_id, r.prompt_id, r.engine, (r.run_date::text || ' 12:00:00+08')::timestamptz, r.prompt,
         jsonb_build_object(
           'object', 'response', 'status', r.response_status,
           'output', jsonb_build_array(jsonb_build_object(
             'type', 'message', 'role', 'assistant', 'status', 'completed',
             'content', jsonb_build_array(jsonb_build_object(
               'type', 'output_text', 'text', r.response_text,
               'annotations', coalesce((select jsonb_agg(jsonb_build_object('type', 'url_citation', 'url', u.url, 'title', null) order by u.ord)
                                        from unnest(r.cited_urls) with ordinality u(url, ord)), '[]'::jsonb))))),
           'profound', r.meta, 'source', 'profound_import'),
         r.response_text, r.response_status,
         case when r.response_status = 'failed' then 'Empty response in Profound export' end,
         r.run_id, v_project.brand_name, v_loc, 'profound_import'
  from _pi_rows r;
  get diagnostics v_resp = row_count;

  insert into public.response_brand_evidence (
    project_id, response_id, brand_id, category, match_source, matched_value, evidence_text, first_position, occurrence_count, confidence)
  select p_project_id, r.rid, v_tracked_id, r.category, 'response_text', v_tracked_name,
         case when r.response_text ~* v_pattern
              then substr(r.response_text, greatest(1, regexp_instr(r.response_text, v_pattern, 1, 1, 0, 'i') - 80), 260)
              else left(r.response_text, 260) end,
         case when r.response_text ~* v_pattern then regexp_instr(r.response_text, v_pattern, 1, 1, 0, 'i') - 1 end,
         greatest(regexp_count(r.response_text, v_pattern, 1, 'i'), 1),
         case when p_presence_source = 'profound' then 'verified' else 'deterministic' end
  from _pi_rows r where r.present;
  get diagnostics v_evidence = row_count;

  insert into public.visibility_daily (
    project_id, metric_date, tracking_location, category, llm_provider, run_id, visibility_score,
    presence_count, response_count, rank_population_status, metric_version, citation_count)
  select p_project_id, u.run_date, v_loc, u.category, u.provider, u.id,
         case when c.resp > 0 then round(c.pres::numeric / c.resp * 100, 1) end,
         case when c.resp > 0 then c.pres end, case when c.resp > 0 then c.resp end, 'unverified', 'v2', 0
  from _pi_runs u
  cross join lateral (
    select (count(*) filter (where r.response_status = 'completed'))::integer as resp,
           (count(*) filter (where r.present))::integer as pres
    from _pi_rows r where r.run_id = u.id) c
  on conflict (project_id, metric_date, category, llm_provider, tracking_location) do update set
    run_id = excluded.run_id, visibility_score = excluded.visibility_score, presence_count = excluded.presence_count,
    response_count = excluded.response_count, share_of_voice_score = null, share_of_voice_rank = null,
    average_position = null, average_position_rank = null, visibility_rank = null, rank_population_count = null,
    rank_population_status = 'unverified', metric_version = 'v2';

  update public.tracking_runs t set published_at = t.completed_at where t.id in (select id from _pi_runs);

  v_engine := public.recompute_competitor_metrics(p_project_id, v_dmin, v_dmax);

  insert into public.citations (
    project_id, metric_date, category, llm_provider, url, page_name, brand_name, is_brand_related, frequency, tracking_location)
  select p_project_id, r.run_date, r.category, r.engine, c.url,
         replace(replace(regexp_replace(c.host, '[.][^.]+$', ''), '-', ' '), '_', ' '),
         case when c.related then v_project.brand_name else replace(replace(regexp_replace(c.host, '[.][^.]+$', ''), '-', ' '), '_', ' ') end,
         c.related, count(distinct r.rid)::integer, v_loc
  from _pi_rows r
  cross join lateral unnest(r.cited_urls) cu(url)
  cross join lateral (
    select cu.url as url,
           regexp_replace(lower(split_part(split_part(regexp_replace(cu.url, '^https?://', '', 'i'), '/', 1), ':', 1)), '^www[.]', '') as host
  ) h
  cross join lateral (
    select h.url as url, h.host as host,
           exists (select 1 from unnest(coalesce(v_project.brand_domains, '{}')) bd(dom)
                   where regexp_replace(lower(bd.dom), '^www[.]', '') <> ''
                     and (h.host = regexp_replace(lower(bd.dom), '^www[.]', '') or h.host like '%.' || regexp_replace(lower(bd.dom), '^www[.]', ''))) as related
  ) c
  where r.response_status = 'completed' and cu.url ~* '^https?://'
  group by r.run_date, r.category, r.engine, c.url, c.host, c.related
  on conflict (project_id, metric_date, category, llm_provider, url, tracking_location) do update set
    frequency = excluded.frequency, page_name = excluded.page_name, brand_name = excluded.brand_name, is_brand_related = excluded.is_brand_related;
  get diagnostics v_citations = row_count;

  return jsonb_build_object(
    'status', 'completed', 'batch', p_batch, 'location', v_loc, 'presence_source', p_presence_source,
    'date_from', v_dmin, 'date_to', v_dmax, 'unmatched_rows', v_unmatched, 'skipped_engine_days', v_skipped,
    'runs', v_runs, 'responses', v_resp, 'tracked_evidence_rows', v_evidence, 'citation_rows', v_citations, 'engine', v_engine);
end;
$_$;


ALTER FUNCTION "public"."import_profound_batch"("p_project_id" "uuid", "p_batch" "text", "p_replace_existing" boolean, "p_presence_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_member"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select public.is_superadmin() or exists(select 1 from public.project_members pm where pm.project_id=p_project_id and pm.user_id=auth.uid()) $$;


ALTER FUNCTION "public"."is_project_member"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_superadmin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select coalesce((select role = 'superadmin' from public.profiles where id = auth.uid()),false) $$;


ALTER FUNCTION "public"."is_superadmin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preserve_raw_responses_on_project_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.ai_responses
  set project_snapshot = jsonb_build_object(
        'id', old.id,
        'brand_name', old.brand_name,
        'brand_description', old.brand_description,
        'brand_domains', old.brand_domains,
        'brand_terms', old.brand_terms,
        'categories', old.categories
      ),
      brand_name_snapshot = old.brand_name
  where project_id = old.id;

  return old;
end;
$$;


ALTER FUNCTION "public"."preserve_raw_responses_on_project_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_competitor_recompute_jobs"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '30min'
    AS $$
declare j record; res jsonb;
begin
  update public.competitor_recompute_jobs set status = 'failed', completed_at = now(),
    error_message = 'timed out while running'
  where status = 'running' and started_at < now() - interval '1 hour';

  select * into j from public.competitor_recompute_jobs
  where status = 'queued' and requested_at <= now() - interval '20 seconds'
  order by requested_at limit 1 for update skip locked;
  if not found then return 0; end if;

  update public.competitor_recompute_jobs set status = 'running', started_at = now() where id = j.id;
  begin
    res := public.recompute_competitor_metrics(j.project_id);
    update public.competitor_recompute_jobs set status = 'completed', completed_at = now(), summary = res where id = j.id;
  exception when others then
    update public.competitor_recompute_jobs set status = 'failed', completed_at = now(), error_message = left(sqlerrm, 500) where id = j.id;
  end;
  return 1;
end;
$$;


ALTER FUNCTION "public"."process_competitor_recompute_jobs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_superadmin_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if old.is_permanent and old.role = 'superadmin' then
    raise exception 'Permanent Superadmin accounts can only be deleted directly from the database';
  end if;
  return old;
end;
$$;


ALTER FUNCTION "public"."protect_superadmin_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_superadmin_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if old.is_permanent and old.role = 'superadmin' then
    if new.id <> old.id or new.is_permanent = false or new.role <> 'superadmin' then
      raise exception 'Permanent Superadmin accounts cannot be demoted or made non-permanent';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_superadmin_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_cross_engine_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '10min'
    AS $$
declare
  v_categories text[];
  v_tracked_id uuid;
  sc text;
  v_members uuid[];
  v_member_categories text[];
  v_member_providers text[];
  v_agg uuid;
  v_last uuid;
  v_pres integer;
  v_resp integer;
  v_rank record;
  v_mine numeric;
  v_comp numeric;
  v_sov numeric;
  v_sov_rank integer;
  v_pos numeric;
  v_pos_rank integer;
  v_citations integer;
  v_ret uuid;
begin
  select array(select t from unnest(p.categories) t where t <> 'Overall') into v_categories
  from public.projects p where p.id = p_project_id;
  if coalesce(cardinality(v_categories), 0) = 0 then return null; end if;
  select b.id into v_tracked_id from public.brand_registry b
  where b.project_id = p_project_id and b.is_tracked_brand and b.is_active limit 1;
  if v_tracked_id is null then return null; end if;

  foreach sc in array (v_categories || array['Overall']) loop
    select array_agg(r.id order by r.provider, r.category), array_agg(r.category order by r.provider, r.category),
           array_agg(r.provider order by r.provider, r.category)
    into v_members, v_member_categories, v_member_providers
    from (
      select distinct on (tr.provider, tr.category) tr.id, tr.category, tr.provider
      from public.tracking_runs tr
      where tr.project_id = p_project_id and tr.tracking_location = p_location
        and tr.status = 'completed' and tr.published_at is not null and tr.superseded_at is null
        and tr.run_kind = 'topic' and tr.provider <> 'Overall' and tr.category = any(v_categories)
        and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
        and (sc = 'Overall' or tr.category = sc)
      order by tr.provider, tr.category, tr.published_at desc, tr.id desc
    ) r;
    if coalesce(cardinality(v_members), 0) = 0 then continue; end if;
    if sc = 'Overall' and (select count(distinct t) from unnest(v_member_categories) t) <> cardinality(v_categories) then continue; end if;

    select sum(t.presence_count), sum(t.response_count) into v_pres, v_resp
    from unnest(v_members, v_member_categories) m(run_id, category)
    cross join lateral public.run_tracked_presence(m.run_id, m.category) t;
    if coalesce(v_resp, 0) = 0 then continue; end if;

    select x.id into v_agg
    from public.tracking_runs x
    where x.project_id = p_project_id and x.provider = 'Overall' and x.tracking_location = p_location
      and x.run_kind = 'overall_aggregate' and x.published_at is not null and x.superseded_at is null
      and coalesce(x.category, '') = case when sc = 'Overall' then '' else sc end
      and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
      and exists (select 1 from public.visibility_daily v
                  where v.run_id = x.id and v.category = sc and v.llm_provider = 'Overall'
                    and v.source_run_ids is not distinct from v_members)
    limit 1;
    if v_agg is null then
      select x.id into v_last from public.tracking_runs x
      where x.project_id = p_project_id and x.provider = 'Overall' and x.tracking_location = p_location
        and x.run_kind = 'overall_aggregate' and coalesce(x.category, '') = case when sc = 'Overall' then '' else sc end
        and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
      order by x.superseded_at desc nulls last, x.published_at desc limit 1;
      update public.tracking_runs set superseded_at = now()
      where project_id = p_project_id and provider = 'Overall' and tracking_location = p_location
        and run_kind = 'overall_aggregate' and published_at is not null and superseded_at is null
        and coalesce(category, '') = case when sc = 'Overall' then '' else sc end
        and (published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date;
      insert into public.tracking_runs (
        project_id, provider, status, total_prompts, completed_prompts, failed_prompts, started_at, completed_at,
        tracking_location, category, published_at, run_kind, supersedes_run_id, data_source)
      select p_project_id, 'Overall', 'completed', sum(total_prompts), sum(completed_prompts), 0, min(started_at), max(completed_at),
             p_location, case when sc = 'Overall' then null else sc end, max(published_at), 'overall_aggregate', v_last, 'cross_engine_pool'
      from public.tracking_runs where id = any(v_members)
      returning id into v_agg;
    end if;

    insert into public.category_brand_observations (
      project_id, brand_id, category, metric_date, tracking_location, llm_provider,
      presence_count, response_count, mention_count, citation_count, average_position, run_id)
    select p_project_id, o.brand_id, sc, p_metric_date, p_location, 'Overall',
           sum(o.presence_count), sum(o.response_count), sum(o.mention_count), sum(o.citation_count),
           case when sum(o.presence_count) filter (where o.average_position is not null) > 0
                then round(sum(o.average_position * o.presence_count) filter (where o.average_position is not null)
                           / sum(o.presence_count) filter (where o.average_position is not null), 2) end,
           v_agg
    from public.category_brand_observations o
    join unnest(v_members, v_member_categories, v_member_providers) m(run_id, category, provider)
      on o.run_id = m.run_id and o.category = m.category and o.llm_provider = m.provider
    join public.category_brand_assignments a on a.project_id = o.project_id and a.brand_id = o.brand_id
      and a.category = o.category and a.role = 'competitor' and a.include_in_metrics
    where o.project_id = p_project_id and o.tracking_location = p_location and o.response_count > 0
    group by o.brand_id
    on conflict (project_id, brand_id, category, metric_date, tracking_location, llm_provider) do update set
      presence_count = excluded.presence_count, response_count = excluded.response_count,
      mention_count = excluded.mention_count, citation_count = excluded.citation_count,
      average_position = excluded.average_position, run_id = excluded.run_id;
    delete from public.category_brand_observations
    where project_id = p_project_id and category = sc and metric_date = p_metric_date
      and tracking_location = p_location and llm_provider = 'Overall' and run_id is distinct from v_agg;

    select * into v_rank from public.canonical_scoped_rank(
      p_project_id, v_agg, sc, p_metric_date, 'Overall', p_location, v_pres, v_resp);

    select coalesce(sum(e.occurrence_count), 0) into v_mine
    from public.response_brand_evidence e
    join public.ai_responses ar on ar.id = e.response_id and ar.response_status = 'completed'
    join public.prompts pr on pr.id = ar.prompt_id
    join (select distinct mm.run_id, mm.category,
                 coalesce((select t.source_run_id from public.tracking_runs t where t.id = mm.run_id), mm.run_id) as src
          from unnest(v_members, v_member_categories) mm(run_id, category)) m on ar.run_id = m.src and pr.category = m.category
    where e.brand_id = v_tracked_id and e.match_source = 'response_text';

    select coalesce(sum(o.mention_count), 0) into v_comp
    from public.category_brand_observations o where o.run_id = v_agg and o.category = sc and o.response_count > 0;
    v_sov := case when v_mine + v_comp > 0 then round(v_mine / (v_mine + v_comp) * 100, 1) else 0 end;
    v_sov_rank := 1 + (select count(*) from public.category_brand_observations o
                       where o.run_id = v_agg and o.category = sc and o.response_count > 0 and o.mention_count > v_mine)::integer;

    select round(avg(z.rk)::numeric, 2) into v_pos
    from (
      select 1 + (select count(*) from public.response_brand_evidence c
                  where c.response_id = e.response_id and c.match_source = 'response_text'
                    and c.brand_id <> v_tracked_id and c.first_position < e.first_position) as rk
      from public.response_brand_evidence e
      join public.ai_responses ar on ar.id = e.response_id and ar.response_status = 'completed'
      join public.prompts pr on pr.id = ar.prompt_id
      join (select distinct mm.run_id, mm.category,
                   coalesce((select t.source_run_id from public.tracking_runs t where t.id = mm.run_id), mm.run_id) as src
            from unnest(v_members, v_member_categories) mm(run_id, category)) m on ar.run_id = m.src and pr.category = m.category
      where e.brand_id = v_tracked_id and e.match_source = 'response_text' and e.first_position is not null
    ) z;
    v_pos_rank := case when v_pos is not null and exists (
        select 1 from public.category_brand_observations o where o.run_id = v_agg and o.category = sc and o.average_position is not null)
      then 1 + (select count(*) from public.category_brand_observations o
                where o.run_id = v_agg and o.category = sc and o.average_position is not null and o.average_position < v_pos)::integer end;

    select coalesce(sum(v.citation_count), 0) into v_citations
    from public.visibility_daily v
    join unnest(v_members, v_member_categories, v_member_providers) m(run_id, category, provider)
      on v.run_id = m.run_id and v.category = m.category and v.llm_provider = m.provider
    where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location;

    insert into public.visibility_daily (
      project_id, metric_date, tracking_location, category, llm_provider, run_id,
      visibility_score, visibility_rank, rank_population_count, rank_population_status,
      share_of_voice_score, share_of_voice_rank, average_position, average_position_rank, citation_count,
      presence_count, response_count, source_run_ids, metric_version)
    values (
      p_project_id, p_metric_date, p_location, sc, 'Overall', v_agg,
      round(v_pres::numeric / v_resp * 100, 1), v_rank.visibility_rank, v_rank.rank_population_count, v_rank.rank_population_status,
      v_sov, v_sov_rank, v_pos, v_pos_rank, v_citations, v_pres, v_resp, v_members, 'v2')
    on conflict (project_id, metric_date, category, llm_provider, tracking_location) do update set
      run_id = excluded.run_id, visibility_score = excluded.visibility_score, visibility_rank = excluded.visibility_rank,
      rank_population_count = excluded.rank_population_count, rank_population_status = excluded.rank_population_status,
      share_of_voice_score = excluded.share_of_voice_score, share_of_voice_rank = excluded.share_of_voice_rank,
      average_position = excluded.average_position, average_position_rank = excluded.average_position_rank,
      citation_count = excluded.citation_count, presence_count = excluded.presence_count,
      response_count = excluded.response_count, source_run_ids = excluded.source_run_ids,
      metric_version = excluded.metric_version;
    if sc = 'Overall' then v_ret := v_agg; end if;
    v_agg := null;
  end loop;
  return v_ret;
end;
$$;


ALTER FUNCTION "public"."publish_cross_engine_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_engine_overall_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text", "p_provider" "text", "p_write_overall_provider" boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_categories text[];
  v_members uuid[];
  v_member_categories text[];
  v_agg uuid;
  v_pres integer;
  v_resp integer;
  v_rank record;
  v_citations integer;
  v_sov_tracked numeric;
  v_sov_total numeric;
  v_sov_rank integer;
  v_tracked_pos numeric;
  v_pos_rank integer;
begin
  select array(select t from unnest(p.categories) t where t <> 'Overall') into v_categories
  from public.projects p where p.id = p_project_id;
  if coalesce(cardinality(v_categories), 0) = 0 then return null; end if;

  select array_agg(r.id order by r.category), array_agg(r.category order by r.category)
  into v_members, v_member_categories
  from (
    select distinct on (tr.category) tr.id, tr.category
    from public.tracking_runs tr
    where tr.project_id = p_project_id and tr.provider = p_provider and tr.tracking_location = p_location
      and tr.status = 'completed' and tr.published_at is not null and tr.superseded_at is null
      and tr.run_kind = 'topic' and tr.category = any(v_categories)
      and (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
    order by tr.category, tr.published_at desc, tr.id desc
  ) r;

  if coalesce(cardinality(v_members), 0) <> cardinality(v_categories) then return null; end if;

  select sum(t.presence_count), sum(t.response_count) into v_pres, v_resp
  from unnest(v_members, v_member_categories) m(run_id, category)
  cross join lateral public.run_tracked_presence(m.run_id, m.category) t;
  if coalesce(v_resp, 0) = 0 then return null; end if;

  -- Reuse the active aggregate when it already pools exactly these member runs.
  select x.id into v_agg
  from public.tracking_runs x
  where x.project_id = p_project_id and x.provider = p_provider and x.tracking_location = p_location
    and x.run_kind = 'overall_aggregate' and x.published_at is not null and x.superseded_at is null
    and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
    and exists (select 1 from public.visibility_daily v
                where v.run_id = x.id and v.category = 'Overall' and v.llm_provider in ('Overall', p_provider)
                  and v.source_run_ids is not distinct from v_members)
  limit 1;

  if v_agg is null then
    update public.tracking_runs set superseded_at = now()
    where project_id = p_project_id and provider = p_provider and tracking_location = p_location
      and run_kind = 'overall_aggregate' and published_at is not null and superseded_at is null
      and (published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date;

    insert into public.tracking_runs (
      project_id, provider, status, total_prompts, completed_prompts, failed_prompts,
      started_at, completed_at, tracking_location, category, published_at, run_kind, supersedes_run_id
    )
    select p_project_id, p_provider, 'completed', sum(total_prompts), sum(completed_prompts), 0,
      min(started_at), max(completed_at), p_location, null, max(published_at), 'overall_aggregate',
      (select x.id from public.tracking_runs x where x.project_id = p_project_id and x.provider = p_provider
         and x.tracking_location = p_location and x.run_kind = 'overall_aggregate'
         and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = p_metric_date
       order by x.superseded_at desc nulls last, x.published_at desc limit 1)
    from public.tracking_runs where id = any(v_members)
    returning id into v_agg;
  end if;

  insert into public.category_brand_observations (
    project_id, brand_id, category, metric_date, tracking_location, llm_provider,
    presence_count, response_count, mention_count, citation_count, average_position, run_id
  )
  select p_project_id, o.brand_id, 'Overall', p_metric_date, p_location, p_provider,
    sum(o.presence_count), sum(o.response_count), sum(o.mention_count), sum(o.citation_count),
    case when sum(o.presence_count) filter (where o.average_position is not null) > 0
      then round(sum(o.average_position * o.presence_count) filter (where o.average_position is not null)
                 / sum(o.presence_count) filter (where o.average_position is not null), 2) end,
    v_agg
  from public.category_brand_observations o
  join unnest(v_members, v_member_categories) m(run_id, category) on o.run_id = m.run_id and o.category = m.category
  join public.category_brand_assignments a on a.project_id = o.project_id and a.brand_id = o.brand_id
    and a.category = o.category and a.role = 'competitor' and a.include_in_metrics
  where o.project_id = p_project_id and o.llm_provider = p_provider and o.tracking_location = p_location
    and o.response_count > 0
  group by o.brand_id
  on conflict (project_id, brand_id, category, metric_date, tracking_location, llm_provider) do update set
    presence_count = excluded.presence_count, response_count = excluded.response_count,
    mention_count = excluded.mention_count, citation_count = excluded.citation_count,
    average_position = excluded.average_position, run_id = excluded.run_id;

  delete from public.category_brand_observations
  where project_id = p_project_id and category = 'Overall' and metric_date = p_metric_date
    and tracking_location = p_location and llm_provider = p_provider and run_id is distinct from v_agg;

  select * into v_rank from public.canonical_scoped_rank(
    p_project_id, v_agg, 'Overall', p_metric_date, p_provider, p_location, v_pres, v_resp);

  select coalesce(sum(v.citation_count), 0) into v_citations
  from public.visibility_daily v
  join unnest(v_members, v_member_categories) m(run_id, category) on v.run_id = m.run_id and v.category = m.category
  where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
    and v.llm_provider = p_provider;

  select sum(t.total - t.comp), sum(t.total)
  into v_sov_tracked, v_sov_total
  from (
    select (comp.mentions / (1 - v.share_of_voice_score / 100)) as total, comp.mentions as comp
    from public.visibility_daily v
    join unnest(v_members, v_member_categories) m(run_id, category) on v.run_id = m.run_id and v.category = m.category
    cross join lateral (
      select coalesce(sum(o.mention_count), 0)::numeric as mentions from public.category_brand_observations o
      where o.run_id = m.run_id and o.category = m.category and o.llm_provider = p_provider
        and o.tracking_location = p_location and o.metric_date = p_metric_date and o.response_count > 0
        and exists (select 1 from public.category_brand_assignments a
                    where a.project_id = o.project_id and a.brand_id = o.brand_id and a.category = o.category
                      and a.role = 'competitor' and a.include_in_metrics)
    ) comp
    where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
      and v.llm_provider = p_provider and v.share_of_voice_score is not null and v.share_of_voice_score < 100
  ) t;

  v_sov_rank := case when v_sov_total > 0
    then 1 + (select count(*) from public.category_brand_observations o
              where o.run_id = v_agg and o.category = 'Overall' and o.response_count > 0 and o.mention_count > v_sov_tracked)::integer end;

  select sum(v.average_position * t.presence_count) / nullif(sum(t.presence_count), 0)
  into v_tracked_pos
  from public.visibility_daily v
  join unnest(v_members, v_member_categories) m(run_id, category) on v.run_id = m.run_id and v.category = m.category
  cross join lateral public.run_tracked_presence(m.run_id, m.category) t
  where v.project_id = p_project_id and v.metric_date = p_metric_date and v.tracking_location = p_location
    and v.llm_provider = p_provider and v.average_position is not null;
  v_pos_rank := case when v_tracked_pos is not null and exists (
      select 1 from public.category_brand_observations o where o.run_id = v_agg and o.category = 'Overall' and o.average_position is not null)
    then 1 + (select count(*) from public.category_brand_observations o
              where o.run_id = v_agg and o.category = 'Overall' and o.average_position is not null
                and o.average_position < v_tracked_pos)::integer end;

  insert into public.visibility_daily (
    project_id, metric_date, tracking_location, category, llm_provider, run_id,
    visibility_score, visibility_rank, rank_population_count, rank_population_status,
    share_of_voice_score, share_of_voice_rank, average_position, average_position_rank, citation_count,
    presence_count, response_count, source_run_ids, metric_version
  )
  select p_project_id, p_metric_date, p_location, 'Overall', prov, v_agg,
    round(v_pres::numeric / v_resp * 100, 1), v_rank.visibility_rank, v_rank.rank_population_count, v_rank.rank_population_status,
    case when v_sov_total > 0 then round(v_sov_tracked / v_sov_total * 100, 1) end, v_sov_rank,
    case when v_tracked_pos is not null then round(v_tracked_pos, 2) end, v_pos_rank, v_citations,
    v_pres, v_resp, v_members, 'v2'
  from unnest(case when p_write_overall_provider then array['Overall', p_provider] else array[p_provider] end) prov
  on conflict (project_id, metric_date, category, llm_provider, tracking_location) do update set
    run_id = excluded.run_id, visibility_score = excluded.visibility_score, visibility_rank = excluded.visibility_rank,
    rank_population_count = excluded.rank_population_count, rank_population_status = excluded.rank_population_status,
    share_of_voice_score = excluded.share_of_voice_score, share_of_voice_rank = excluded.share_of_voice_rank,
    average_position = excluded.average_position, average_position_rank = excluded.average_position_rank,
    citation_count = excluded.citation_count, presence_count = excluded.presence_count,
    response_count = excluded.response_count, source_run_ids = excluded.source_run_ids,
    metric_version = excluded.metric_version;

  return v_agg;
end;
$$;


ALTER FUNCTION "public"."publish_engine_overall_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text", "p_provider" "text", "p_write_overall_provider" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_overall_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text", "p_provider" "text" DEFAULT 'chatgpt'::"text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.publish_engine_overall_metrics(p_project_id, p_metric_date, p_location, p_provider, true)
$$;


ALTER FUNCTION "public"."publish_overall_metrics"("p_project_id" "uuid", "p_metric_date" "date", "p_location" "text", "p_provider" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_overall_metrics_for_tracking_batch"("p_batch_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_project_id uuid;
  v_location text;
  v_metric_date date;
begin
  select b.project_id into v_project_id
  from public.tracking_batches b where b.id = p_batch_id and b.status = 'completed';
  if v_project_id is null then return; end if;

  select tr.tracking_location, (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date
  into v_location, v_metric_date
  from public.tracking_batch_categories bt
  join public.tracking_runs tr on tr.id = bt.tracking_run_id
  where bt.batch_id = p_batch_id and tr.status = 'completed' and tr.published_at is not null
  order by tr.published_at desc limit 1;
  if v_metric_date is null then return; end if;

  perform public.publish_overall_metrics(v_project_id, v_metric_date, v_location, 'chatgpt');
end;
$$;


ALTER FUNCTION "public"."rebuild_overall_metrics_for_tracking_batch"("p_batch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_competitor_metrics"("p_project_id" "uuid", "p_date_from" "date" DEFAULT NULL::"date", "p_date_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '20min'
    AS $_$
declare
  v_project public.projects%rowtype;
  v_categories text[];
  v_tracked_id uuid;
  v_tracked_pattern text;
  v_tracked_sites text[];
  fr record;
  tn text;
  ur record;
  v_pres integer;
  v_resp integer;
  v_score numeric;
  v_synth uuid;
  v_slices integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_units integer := 0;
  v_obs integer := 0;
  v_evidence integer := 0;
  v_citations integer := 0;
  v_archived integer := 0;
  v_overall integer := 0;
  v_entities integer := 0;
begin
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'project % not found', p_project_id; end if;
  v_categories := array(select x from unnest(v_project.categories) x where x <> 'Overall');
  if coalesce(cardinality(v_categories), 0) = 0 then
    return jsonb_build_object('status', 'skipped', 'reason', 'project has no categories');
  end if;

  select b.id,
         public.alias_match_pattern(array_remove(
           array[v_project.brand_name, b.canonical_name, b.primary_website]
           || coalesce(b.aliases, '{}') || coalesce(v_project.brand_terms, '{}')
           || coalesce(v_project.brand_domains, '{}') || coalesce(b.additional_websites, '{}'), null))
  into v_tracked_id, v_tracked_pattern
  from public.brand_registry b
  where b.project_id = p_project_id and b.is_tracked_brand and b.is_active
  limit 1;

  select array(select distinct public.site_host(w) from unnest(
           coalesce(v_project.brand_domains, '{}') || array[b.primary_website] || coalesce(b.additional_websites, '{}')) w
         where public.site_host(w) is not null)
  into v_tracked_sites
  from public.brand_registry b
  where b.project_id = p_project_id and b.is_tracked_brand and b.is_active
  limit 1;

  -- 1. Republish verifiable per-category slices of older all-category runs.
  for fr in
    select distinct on (tr.d, tr.tracking_location, tr.provider) tr.*
    from (
      select r.*, (r.completed_at at time zone 'Asia/Kuala_Lumpur')::date as d
      from public.tracking_runs r
      where r.project_id = p_project_id and r.run_kind = 'full' and r.status = 'completed'
        and r.completed_at is not null and r.provider = 'chatgpt'
    ) tr
    where (p_date_from is null or tr.d >= p_date_from) and (p_date_to is null or tr.d <= p_date_to)
      and not exists (
        select 1 from public.tracking_runs x
        where x.project_id = tr.project_id and x.run_kind = 'topic' and x.source_run_id is null
          and x.status = 'completed' and x.published_at is not null and x.superseded_at is null
          and x.tracking_location = tr.tracking_location and x.provider = tr.provider
          and (x.published_at at time zone 'Asia/Kuala_Lumpur')::date = tr.d)
    order by tr.d, tr.tracking_location, tr.provider, tr.completed_at desc
  loop
    foreach tn in array v_categories loop
      if exists (select 1 from public.tracking_runs x
                 where x.source_run_id = fr.id and x.category = tn and x.published_at is not null and x.superseded_at is null) then
        continue;
      end if;
      select p.presence_count, p.response_count into v_pres, v_resp from public.run_tracked_presence(fr.id, tn) p;
      select v.visibility_score into v_score from public.visibility_daily v
      where v.project_id = p_project_id and v.metric_date = fr.d and v.category = tn
        and v.llm_provider = 'Overall' and v.tracking_location = fr.tracking_location;
      if coalesce(v_resp, 0) > 0 and v_score is not null
         and abs(round(v_pres::numeric / v_resp * 100, 1) - v_score) <= 0.05 then
        insert into public.tracking_runs (
          project_id, provider, status, total_prompts, completed_prompts, failed_prompts, started_at, completed_at,
          tracking_location, category, published_at, run_kind, source_run_id, error_message)
        values (p_project_id, fr.provider, 'completed', v_resp, v_resp, 0, fr.started_at, fr.completed_at,
          fr.tracking_location, tn, fr.completed_at, 'topic', fr.id, 'Backfilled category slice of all-category run ' || fr.id)
        returning id into v_synth;
        update public.visibility_daily set run_id = v_synth
        where project_id = p_project_id and metric_date = fr.d and category = tn
          and tracking_location = fr.tracking_location and llm_provider in ('Overall', 'chatgpt');
        v_slices := v_slices + 1;
      else
        v_skipped := v_skipped || jsonb_build_object(
          'date', fr.d, 'topic', tn, 'stored_score', v_score,
          'recomputed', case when coalesce(v_resp, 0) > 0 then round(v_pres::numeric / v_resp * 100, 1) end);
      end if;
    end loop;
  end loop;

  -- 2. Units = published category runs (real or backfilled slices) in range.
  -- Temp tables are transaction-scoped; process one project per transaction.
  create temp table _cm_units on commit drop as
  select tr.id as unit_run, coalesce(tr.source_run_id, tr.id) as src_run, tr.category, tr.tracking_location as loc,
         tr.provider, (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date as d
  from public.tracking_runs tr
  where tr.project_id = p_project_id and tr.run_kind = 'topic' and tr.status = 'completed'
    and tr.published_at is not null and tr.superseded_at is null and tr.provider <> 'Overall'
    and tr.category = any(v_categories)
    and (p_date_from is null or (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date >= p_date_from)
    and (p_date_to is null or (tr.published_at at time zone 'Asia/Kuala_Lumpur')::date <= p_date_to);

  create temp table _cm_resp on commit drop as
  select distinct on (u.unit_run, ar.prompt_id) u.unit_run, u.src_run, u.category, u.loc, u.d, u.provider,
         ar.id as response_id, ar.response_text, ar.raw_response
  from _cm_units u
  join public.ai_responses ar on ar.run_id = u.src_run and ar.response_status = 'completed'
    and coalesce(btrim(ar.response_text), '') <> ''
  join public.prompts p on p.id = ar.prompt_id and p.category = u.category
  order by u.unit_run, ar.prompt_id, ar.captured_at desc, ar.id desc;
  create index on _cm_resp (unit_run);

  create temp table _cm_entities on commit drop as
  select * from public.competitor_entities(p_project_id) e where e.pattern is not null and e.category = any(v_categories);
  select count(distinct brand_id) into v_entities from _cm_entities;

  -- 3a. Text matches (competitors) plus the tracked brand for position ordering.
  create temp table _cm_hits on commit drop as
  select r.unit_run, r.response_id, e.brand_id, false as is_tracked,
         regexp_count(r.response_text, e.pattern, 1, 'i') as n,
         regexp_instr(r.response_text, e.pattern, 1, 1, 0, 'i') as pos
  from _cm_resp r
  join _cm_entities e on e.category = r.category and r.response_text ~* e.pattern;
  if v_tracked_pattern is not null then
    insert into _cm_hits
    select r.unit_run, r.response_id, v_tracked_id, true,
           regexp_count(r.response_text, v_tracked_pattern, 1, 'i'),
           regexp_instr(r.response_text, v_tracked_pattern, 1, 1, 0, 'i')
    from _cm_resp r where r.response_text ~* v_tracked_pattern
      and not exists (select 1 from public.tracking_runs tx where tx.id = r.unit_run and tx.data_source = 'profound_import');
    -- Imported runs: the tracked brand's presence is the stored evidence (it may come from the source's own flag).
    insert into _cm_hits
    select r.unit_run, r.response_id, v_tracked_id, true, e.occurrence_count, e.first_position + 1
    from _cm_resp r
    join public.response_brand_evidence e on e.response_id = r.response_id and e.brand_id = v_tracked_id and e.match_source = 'response_text'
    where exists (select 1 from public.tracking_runs tx where tx.id = r.unit_run and tx.data_source = 'profound_import');
  end if;

  -- 3b. Evidence for the current competitor set (response-text matches).
  insert into public.response_brand_evidence (
    project_id, response_id, brand_id, category, match_source, matched_value, evidence_text,
    first_position, occurrence_count, confidence)
  select p_project_id, h.response_id, h.brand_id, e.category, 'response_text', e.canonical_name,
         substr(r.response_text, greatest(1, h.pos - 80), 260), h.pos - 1, h.n, 'deterministic'
  from _cm_hits h
  join _cm_resp r on r.response_id = h.response_id and r.unit_run = h.unit_run
  join _cm_entities e on e.brand_id = h.brand_id and e.category = r.category
  where not h.is_tracked
  on conflict (response_id, brand_id, category, match_source, matched_value) do update set