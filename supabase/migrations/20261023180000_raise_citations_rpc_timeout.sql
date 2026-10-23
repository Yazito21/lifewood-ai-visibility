-- Citation aggregations cover a wider date window than most dashboard RPCs.
-- Allow these read-only, project-scoped aggregations more time before PostgREST cancels them.
ALTER FUNCTION public.get_cumulative_citations(uuid, date, date, text, text[], boolean, text)
  SET statement_timeout = '30s';

ALTER FUNCTION public.get_third_party_mentions(uuid, date, date, text, text[], text)
  SET statement_timeout = '30s';
