-- Tracking runs failed at the topic-cleanup step with "permission denied for table citation_occurrences".
-- The table was created for Issue 04 without grants for service_role, the role the visibility-tracking
-- edge function uses. Every run after that migration died before sending a single prompt's results.
grant select, insert, update, delete on public.citation_occurrences to service_role;
