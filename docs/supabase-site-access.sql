-- Run once in the Supabase SQL Editor to enable Google-login access requests.
-- Set SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) on the API server in
-- addition to the existing SUPABASE_URL and service-role key configuration.
create table if not exists public.site_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'blocked')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  denial_reason text,
  blocked_until timestamptz,
  blocked_reason text,
  status_before_block text not null default 'pending'
    check (status_before_block in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_access_status_requested_idx
  on public.site_access (status, requested_at desc);

alter table public.site_access enable row level security;
revoke all on table public.site_access from anon, authenticated;

comment on table public.site_access is
  'Google-authenticated site access requests and admin-managed approvals/blocks; accessed only by the API service role.';