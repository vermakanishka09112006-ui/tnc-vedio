-- Persist Google-account study history, completion data, and favorites.
alter table public.site_access
  add column if not exists avatar_url text;

create table if not exists public.site_user_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  watch_history jsonb not null default '{}'::jsonb,
  study_data jsonb not null default '{}'::jsonb,
  favorites jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.merge_site_activity_jsonb(existing jsonb, incoming jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  merged jsonb;
begin
  if existing is null then return coalesce(incoming, '{}'::jsonb); end if;
  if incoming is null then return existing; end if;

  if jsonb_typeof(existing) = 'object' and jsonb_typeof(incoming) = 'object' then
    select coalesce(jsonb_object_agg(items.key, case
      when items.old_value is null then items.new_value
      when items.new_value is null then items.old_value
      else public.merge_site_activity_jsonb(items.old_value, items.new_value)
    end), '{}'::jsonb)
    into merged
    from (
      select coalesce(old_items.key, new_items.key) as key, old_items.value as old_value, new_items.value as new_value
      from jsonb_each(existing) as old_items
      full outer join jsonb_each(incoming) as new_items using (key)
    ) as items;
    return merged;
  end if;

  if jsonb_typeof(existing) = 'array' and jsonb_typeof(incoming) = 'array' then
    select coalesce(jsonb_agg(values.value), '[]'::jsonb)
    into merged
    from (
      select value from jsonb_array_elements(existing)
      union
      select value from jsonb_array_elements(incoming)
    ) as values;
    return merged;
  end if;

  return incoming;
end;
$$;

create or replace function public.sync_site_user_activity(
  p_user_id uuid,
  p_watch_history jsonb,
  p_study_data jsonb,
  p_favorites jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.site_user_activity (user_id, watch_history, study_data, favorites, updated_at)
  values (p_user_id, coalesce(p_watch_history, '{}'::jsonb), coalesce(p_study_data, '{}'::jsonb), coalesce(p_favorites, '{}'::jsonb), now())
  on conflict (user_id) do update set
    watch_history = public.merge_site_activity_jsonb(site_user_activity.watch_history, excluded.watch_history),
    study_data = public.merge_site_activity_jsonb(site_user_activity.study_data, excluded.study_data),
    favorites = public.merge_site_activity_jsonb(site_user_activity.favorites, excluded.favorites),
    updated_at = now();
$$;

alter table public.site_user_activity enable row level security;
revoke all on table public.site_user_activity from anon, authenticated;
revoke all on function public.merge_site_activity_jsonb(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.sync_site_user_activity(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_site_user_activity(uuid, jsonb, jsonb, jsonb) to service_role;
