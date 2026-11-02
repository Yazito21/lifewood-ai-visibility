-- Prompt limit drops from 100 to 50 per project. All existing prompts are cleared; they are refilled by hand.
-- Safety copy first: deleting prompts sets prompt_id to NULL on ai_responses and citations, and this table keeps the old id/topic mapping.
create table if not exists public.prompts_backup_20261101 as table public.prompts;
alter table public.prompts_backup_20261101 enable row level security;
revoke all on public.prompts_backup_20261101 from anon, authenticated;

delete from public.prompts;

alter table public.prompts drop constraint prompts_prompt_number_check;
alter table public.prompts add constraint prompts_prompt_number_check check (prompt_number >= 1 and prompt_number <= 50);
