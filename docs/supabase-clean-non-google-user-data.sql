-- Destructive one-time cleanup: remove non-Google user data while preserving
-- Google Auth users, site_access, site_user_activity, and Google-linked visits.
-- The requester confirmed no backup is wanted.
begin;

-- Historical Telegram study data and Telegram profiles.
delete from public.study_sessions;
delete from public.bot_users;

-- Fingerprint/anonymous website history. Keep only rows tied to Google access.
delete from public.website_study_sessions w
where left(w.visitor_id, 7) <> 'google_'
  and not exists (
    select 1
    from public.site_access s
    where w.visitor_id = 'google_' || s.user_id::text
  );

delete from public.web_study_sessions w
where left(w.learner_id, 7) <> 'google_'
  and not exists (
    select 1
    from public.site_access s
    where w.learner_id in (s.user_id::text, 'google_' || s.user_id::text)
  );

delete from public.site_visits v
where left(v.visitor_id, 7) <> 'google_'
  and not exists (
    select 1
    from public.site_access s
    where v.visitor_id in (s.user_id::text, 'google_' || s.user_id::text)
  );

-- Legacy local accounts and anonymous mobile installs/activity.
delete from public.app_users;
delete from public.offline_downloads;
delete from public.mobile_app_events;
delete from public.mobile_app_users;

-- User-targeted Telegram broadcast history and mirrored user rows.
delete from public.broadcast_logs;
delete from public.api_mirror
where source_table in (
  'app_users', 'bot_users', 'study_sessions', 'website_study_sessions',
  'web_study_sessions', 'site_visits', 'mobile_app_users',
  'mobile_app_events', 'offline_downloads', 'broadcast_logs'
);

-- Remove non-Google Supabase Auth users only; FK cascades clear their linked
-- site_access/site_user_activity records. Google-linked accounts are retained.
delete from auth.users u
where not exists (
  select 1
  from auth.identities i
  where i.user_id = u.id
    and i.provider = 'google'
);

commit;
