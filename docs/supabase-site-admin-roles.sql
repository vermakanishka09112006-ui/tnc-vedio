-- Website admin roles. The superadmin identity is fixed in the API as
-- shashanksv2009@gmail.com; this table stores regular admins only.
create table if not exists public.site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role = 'admin'),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

create table if not exists public.site_admin_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  target_email text not null,
  action text not null check (action in ('promote', 'remove')),
  created_at timestamptz not null default now()
);

alter table public.site_admins enable row level security;
alter table public.site_admin_audit enable row level security;
revoke all on table public.site_admins from anon, authenticated;
revoke all on table public.site_admin_audit from anon, authenticated;

insert into public.site_admins (user_id, role, granted_by)
select target.id, 'admin', superuser.id
from auth.users as target
left join auth.users as superuser on lower(superuser.email) = 'shashanksv2009@gmail.com'
where lower(target.email) = 'omkarsuryawanshi0444@gmail.com'
on conflict (user_id) do update set role = 'admin';
