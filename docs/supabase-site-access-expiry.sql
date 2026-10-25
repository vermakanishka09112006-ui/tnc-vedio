-- Add expiry for temporary approvals and rate limiting for Telegram notices.
alter table public.site_access
  add column if not exists approved_until timestamptz,
  add column if not exists admin_notified_at timestamptz;