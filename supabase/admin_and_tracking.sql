-- Rol, çalışma süresi ve işlem geçmişi.
-- Supabase SQL Editor'da bir kez çalıştırın.
-- companies / regions / transit_lines / map_points politikalarına dokunmaz.
-- Bölge sınırı region_slug ile kurulur. 'all' tüm bölgeleri görür.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  region_slug text not null default 'all',
  created_at timestamptz not null default now()
);

create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  region_slug text,
  login_at timestamptz not null default now(),
  last_ping_at timestamptz not null default now(),
  active_seconds int not null default 0,
  idle_seconds int not null default 0,
  is_online boolean not null default true
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  user_name text,
  region_slug text,
  action_type text not null check (action_type in ('create', 'update', 'delete', 'urgent_toggle', 'status_toggle')),
  target_title text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists work_sessions_user_idx on public.work_sessions (user_id, login_at desc);
create index if not exists activity_logs_created_idx on public.activity_logs (created_at desc);
create index if not exists activity_logs_region_idx on public.activity_logs (region_slug, created_at desc);

create or replace function public.is_region_admin(target_region text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and (p.region_slug = 'all' or p.region_slug is not distinct from target_region)
  );
$$;

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.role is distinct from 'employee' then
    raise exception 'Profil yalnızca employee rolüyle açılabilir';
  end if;
  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    raise exception 'Rol bu oturumdan değiştirilemez';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.user_profiles;
create trigger protect_profile_role
  before insert or update on public.user_profiles
  for each row execute function public.protect_profile_role();

alter table public.user_profiles enable row level security;
alter table public.work_sessions enable row level security;
alter table public.activity_logs enable row level security;

revoke all on table public.user_profiles from anon, public;
revoke all on table public.work_sessions from anon, public;
revoke all on table public.activity_logs from anon, public;

grant select, insert, update on table public.user_profiles to authenticated;
grant select, insert, update on table public.work_sessions to authenticated;
grant select, insert on table public.activity_logs to authenticated;
grant execute on function public.is_region_admin(text) to authenticated;

drop policy if exists profiles_select on public.user_profiles;
drop policy if exists profiles_insert on public.user_profiles;
drop policy if exists profiles_update on public.user_profiles;
drop policy if exists sessions_select on public.work_sessions;
drop policy if exists sessions_insert on public.work_sessions;
drop policy if exists sessions_update on public.work_sessions;
drop policy if exists logs_select on public.activity_logs;
drop policy if exists logs_insert on public.activity_logs;

create policy profiles_select on public.user_profiles
  for select to authenticated
  using (id = auth.uid() or public.is_region_admin(region_slug));

create policy profiles_insert on public.user_profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'employee');

create policy profiles_update on public.user_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = 'employee');

create policy sessions_select on public.work_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.is_region_admin(region_slug));

create policy sessions_insert on public.work_sessions
  for insert to authenticated
  with check (user_id = auth.uid());

create policy sessions_update on public.work_sessions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy logs_select on public.activity_logs
  for select to authenticated
  using (user_id = auth.uid() or public.is_region_admin(region_slug));

create policy logs_insert on public.activity_logs
  for insert to authenticated
  with check (user_id = auth.uid());

insert into public.user_profiles (id, email, full_name, role, region_slug)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  'admin',
  'all'
from auth.users u
where lower(u.email) = 'bariscandasci1@gmail.com'
on conflict (id) do update
set
  role = 'admin',
  region_slug = 'all',
  email = excluded.email,
  full_name = coalesce(public.user_profiles.full_name, excluded.full_name);
