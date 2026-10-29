-- Third-party mentions for imported Profound responses, and retirement of the staging table.
--
-- profound_import_rows was only a staging area (see 20261029100000); the imported responses live in ai_responses
-- (data_source = 'profound_import'), which is all this function needs. A future import loads a new staging table first.
-- Note: import_profound_batch() reads profound_import_rows; recreate the table from that migration before importing again.
drop table if exists public.profound_import_rows;

-- Builds third_party_mentions from the cited pages (url_citation annotations) of imported responses, relating each page to
-- the brands the tracking run would relate it to: brands named in the page title or URL, else brands named in the same answer.
-- For the engine days it covers it also removes what the retired platform runs had recorded (third-party mentions, citation
-- occurrences) and citations rows that only those runs produced, so nothing is counted twice.
create or replace function public.build_profound_third_party_mentions(p_project_id uuid, p_date_from date, p_date_to date)
returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '10min' as $$
declare
  v_project public.projects%rowtype;
  v_rows integer;
  v_old_third integer;
  v_old_occ integer;
  v_stale_citations integer;
begin
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'project % not found', p_project_id; end if;

  create temp table _tp_brands on commit drop as
  select a.topic, b.id as brand_id, b.canonical_name,
         public.alias_match_pattern(array(
           select distinct btrim(x) from unnest(
             array[b.canonical_name] || coalesce(b.aliases, '{}') || coalesce(a.aliases, '{}')
             || case when a.role = 'tracked_brand' then coalesce(v_project.brand_terms, '{}') else '{}'::text[] end) x
           where length(btrim(x)) > 1)) as pattern
  from public.topic_brand_assignments a
  join public.brand_registry b on b.id = a.brand_id and b.is_active
  where a.project_id = p_project_id and a.include_in_metrics;

  create temp table _tp_src on commit drop as
  select distinct on (x.response_id, x.canonical_url)
         x.response_id, x.provider, x.loc, x.d, x.topic, x.url, x.title, x.canonical_url, x.host
  from (
    select ar.id as response_id, ar.llm_provider as provider, ar.tracking_location as loc,
           (ar.captured_at at time zone 'Asia/Kuala_Lumpur')::date as d, pr.topic,
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

  create temp table _tp_direct on commit drop as
  select s.response_id, s.canonical_url, array_agg(distinct b.brand_id) as ids
  from _tp_src s
  join _tp_brands b on b.topic = s.topic and b.pattern is not null and lower(s.title || ' ' || s.url) ~* b.pattern
  group by s.response_id, s.canonical_url;

  create temp table _tp_answer on commit drop as
  select e.response_id, array_agg(distinct e.brand_id) as ids
  from public.response_brand_evidence e
  where e.match_source = 'response_text' and e.response_id in (select response_id from _tp_src)
  group by e.response_id;

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

  delete from public.citations c
  where c.project_id = p_project_id and c.metric_date between p_date_from and p_date_to
    and exists (select 1 from _tp_src s where s.d = c.metric_date and s.provider = c.llm_provider and s.topic = c.topic)
    and not exists (select 1 from _tp_src s where s.d = c.metric_date and s.provider = c.llm_provider and s.topic = c.topic and s.url = c.url);
  get diagnostics v_stale_citations = row_count;

  insert into public.third_party_mentions (
    project_id, response_id, metric_date, topic, llm_provider, tracking_location, url, canonical_url, hostname, website_name,
    source_type, associated_brand_ids, associated_brand_names, association_status, frequency)
  select p_project_id, s.response_id, s.d, s.topic, s.provider, s.loc, s.url, s.canonical_url, s.host,
         coalesce(nullif(s.title, ''), replace(replace(regexp_replace(s.host, '[.][^.]+$', ''), '-', ' '), '_', ' ')),
         'citation_annotation', rel.ids,
         array(select br.canonical_name from public.brand_registry br where br.id = any(rel.ids) order by br.canonical_name),
         'inferred', 1
  from _tp_src s
  left join _tp_direct d on d.response_id = s.response_id and d.canonical_url = s.canonical_url
  left join _tp_answer a on a.response_id = s.response_id
  cross join lateral (select coalesce(d.ids, a.ids) as ids) rel
  where coalesce(cardinality(rel.ids), 0) > 0
  on conflict (project_id, response_id, canonical_url, source_type, topic, tracking_location) do update set
    associated_brand_ids = excluded.associated_brand_ids, associated_brand_names = excluded.associated_brand_names,
    website_name = excluded.website_name;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('third_party_rows', v_rows, 'replaced_third_party_rows', v_old_third,
    'removed_retired_citation_occurrences', v_old_occ, 'removed_stale_citations', v_stale_citations,
    'cited_pages_seen', (select count(*) from _tp_src));
end;
$$;

revoke all on function public.build_profound_third_party_mentions(uuid, date, date) from public, anon, authenticated;
grant execute on function public.build_profound_third_party_mentions(uuid, date, date) to service_role;
