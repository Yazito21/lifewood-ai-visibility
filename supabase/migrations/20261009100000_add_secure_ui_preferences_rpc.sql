-- Allow authenticated users to save only their own appearance preferences.
-- Keep role/profile fields protected by existing RLS policies.
create or replace function public.save_my_ui_preferences(p_preferences jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

revoke all on function public.save_my_ui_preferences(jsonb) from public;
revoke all on function public.save_my_ui_preferences(jsonb) from anon;
grant execute on function public.save_my_ui_preferences(jsonb) to authenticated;
