-- Add Google profile photos to website study leaderboard entries.
alter table public.website_study_sessions
  add column if not exists avatar_url text;

drop function if exists public.record_website_study_time(text, text, text, integer);

create or replace function public.record_website_study_time(
  p_visitor_id text,
  p_visitor_name text,
  p_session_id text,
  p_seconds integer,
  p_avatar_url text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_seconds integer := greatest(least(coalesce(p_seconds, 0), 300), 0);
  safe_avatar_url text := case
    when p_avatar_url ~ '^https://([a-zA-Z0-9-]+\.)*googleusercontent\.com/' then left(p_avatar_url, 2048)
    else null
  end;
begin
  if safe_seconds = 0
     or nullif(trim(p_visitor_id), '') is null
     or nullif(trim(p_visitor_name), '') is null
     or nullif(trim(p_session_id), '') is null then
    return;
  end if;

  insert into public.website_study_sessions (
    visitor_id, visitor_name, avatar_url, session_id, study_date, seconds, updated_at
  )
  values (
    left(trim(p_visitor_id), 120),
    left(trim(p_visitor_name), 80),
    safe_avatar_url,
    left(trim(p_session_id), 200),
    current_date,
    safe_seconds,
    now()
  )
  on conflict (visitor_id, session_id, study_date)
  do update set
    visitor_name = excluded.visitor_name,
    avatar_url = coalesce(excluded.avatar_url, public.website_study_sessions.avatar_url),
    seconds = public.website_study_sessions.seconds + excluded.seconds,
    updated_at = now();
end;
$$;

drop view if exists public.study_leaderboard;
create view public.study_leaderboard as
select
  'telegram_' || u.telegram_id::text as participant_id,
  coalesce(nullif(trim(u.first_name), ''), 'Telegram Student') as first_name,
  u.username,
  coalesce(sum(s.seconds), 0)::integer as seconds,
  count(s.id)::integer as sessions,
  null::text as avatar_url
from public.bot_users u
left join public.study_sessions s
  on s.telegram_id = u.telegram_id
  and s.study_date >= date_trunc('week', current_date)::date
where u.is_banned = false
group by u.telegram_id, u.first_name, u.username
union all
select
  'web_' || w.visitor_id as participant_id,
  coalesce(nullif(max(trim(w.visitor_name)), ''), 'Website Student') as first_name,
  null::text as username,
  coalesce(sum(w.seconds), 0)::integer as seconds,
  count(w.id)::integer as sessions,
  max(w.avatar_url) as avatar_url
from public.website_study_sessions w
where w.study_date >= date_trunc('week', current_date)::date
group by w.visitor_id
order by seconds desc;

alter table public.website_study_sessions enable row level security;
revoke all on table public.study_leaderboard from anon, authenticated;
revoke all on function public.record_website_study_time(text, text, text, integer, text) from anon, authenticated;
grant execute on function public.record_website_study_time(text, text, text, integer, text) to service_role;
