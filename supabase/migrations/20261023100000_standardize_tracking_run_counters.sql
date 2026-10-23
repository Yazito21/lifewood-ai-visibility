alter table public.tracking_runs
  add column if not exists attempted_prompts integer not null default 0,
  add column if not exists provider_successful_prompts integer not null default 0,
  add column if not exists provider_failed_prompts integer not null default 0,
  add column if not exists analysis_successful_prompts integer not null default 0,
  add column if not exists published_prompts integer not null default 0,
  add column if not exists stage_code text,
  add column if not exists error_code text,
  add column if not exists error_details text;

comment on column public.tracking_runs.attempted_prompts is 'Number of prompts for which provider execution was actually started.';
comment on column public.tracking_runs.provider_successful_prompts is 'Provider calls that returned a usable response.';
comment on column public.tracking_runs.provider_failed_prompts is 'Provider calls that failed or returned no usable response.';
comment on column public.tracking_runs.analysis_successful_prompts is 'Provider-successful prompts whose required response analysis completed.';
comment on column public.tracking_runs.published_prompts is 'Prompts whose required reporting records were successfully persisted.';
comment on column public.tracking_runs.stage_code is 'Stable machine-readable pipeline stage code at terminal state.';
comment on column public.tracking_runs.error_code is 'Stable machine-readable failure code.';
comment on column public.tracking_runs.error_details is 'Readable failure detail; error_message retained for compatibility.';

update public.tracking_runs
set attempted_prompts = greatest(coalesce(completed_prompts,0) + coalesce(failed_prompts,0),0),
    provider_successful_prompts = greatest(coalesce(completed_prompts,0),0),
    provider_failed_prompts = greatest(coalesce(failed_prompts,0),0),
    analysis_successful_prompts = greatest(coalesce(completed_prompts,0),0),
    published_prompts = case when status = 'completed' then greatest(coalesce(completed_prompts,0),0) else 0 end,
    error_details = error_message
where attempted_prompts = 0 and provider_successful_prompts = 0 and provider_failed_prompts = 0
  and analysis_successful_prompts = 0 and published_prompts = 0;