-- Keep favorites synchronized across devices while allowing removals to persist.
-- Devices merge their local favorites with the server snapshot on sign-in, then
-- write the merged snapshot; subsequent toggles replace the previous snapshot.
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
    favorites = excluded.favorites,
    updated_at = now();
$$;
