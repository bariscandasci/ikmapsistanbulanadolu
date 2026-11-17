-- Giriş yapmamış (anon) rolün okuma ve yazmasını kapatır.
-- INSERT / UPDATE / DELETE ve SELECT yalnızca authenticated rolüne açıktır.
-- Eski tenant_write_policy.sql politikalarının yerine geçer.
-- Supabase SQL Editor'da bir kez çalıştırın.
--
-- Komut satırı betikleri (sync_from_sheets.py, migrate_all_regions.py)
-- publishable anahtarla anon rolünde kalır; bu politikadan sonra yazamaz.
-- O betikler için SUPABASE_KEY değerine service role anahtarı konur.
-- Site içindeki Proje Ekle / Aç-Kapa / Acil / Sheets güncellemesi,
-- giriş yapmış kullanıcının oturumuyla çalışır.

revoke all on table public.companies from anon, public;
revoke all on table public.regions from anon, public;
revoke all on table public.transit_lines from anon, public;
revoke all on table public.map_points from anon, public;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.companies to authenticated;
grant select, insert, update, delete on table public.regions to authenticated;
grant select, insert, update, delete on table public.transit_lines to authenticated;
grant select, insert, update, delete on table public.map_points to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.companies enable row level security;
alter table public.regions enable row level security;
alter table public.transit_lines enable row level security;
alter table public.map_points enable row level security;

drop policy if exists tenant_all_companies on public.companies;
drop policy if exists tenant_all_regions on public.regions;
drop policy if exists tenant_all_transit_lines on public.transit_lines;
drop policy if exists tenant_all_map_points on public.map_points;
drop policy if exists authenticated_all_companies on public.companies;
drop policy if exists authenticated_all_regions on public.regions;
drop policy if exists authenticated_all_transit_lines on public.transit_lines;
drop policy if exists authenticated_all_map_points on public.map_points;

create policy authenticated_all_companies on public.companies
  for all to authenticated using (true) with check (true);
create policy authenticated_all_regions on public.regions
  for all to authenticated using (true) with check (true);
create policy authenticated_all_transit_lines on public.transit_lines
  for all to authenticated using (true) with check (true);
create policy authenticated_all_map_points on public.map_points
  for all to authenticated using (true) with check (true);
