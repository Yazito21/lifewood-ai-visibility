-- Idempotent response persistence within one logical run. Historical run rows remain untouched.
create unique index if not exists ai_responses_run_prompt_provider_location_uidx
  on public.ai_responses (run_id, prompt_id, llm_provider, tracking_location)
  where run_id is not null and prompt_id is not null;

comment on index public.ai_responses_run_prompt_provider_location_uidx is
  'Prevents duplicate prompt/provider/location response rows within a logical tracking run; deliberate reruns use a distinct run_id.';
