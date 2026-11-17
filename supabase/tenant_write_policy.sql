-- Publishable anahtarla okuma zaten açık. Yazma (migration + Proje Ekle)
-- satır düzeyi güvenlik yüzünden kapalıysa bu dosyayı Supabase SQL Editor'da
-- bir kez çalıştırın. Anahtar herkese açık olduğu için bu politikalar,
-- anahtarı gören herkese yazma hakkı verir. Canlı satışta yazmayı gizli
-- anahtara (service role) taşıyıp bu politikaları daraltın.

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.companies to anon, authenticated;
grant select, insert, update, delete on table public.regions to anon, authenticated;
grant select, insert, update, delete on table public.transit_lines to anon, authenticated;
grant select, insert, update, delete on table public.map_points to anon, authenticated;

alter table public.companies enable row level security;
alter table public.regions enable row level security;
alter table public.transit_lines enable row level security;
alter table public.map_points enable row level security;

drop policy if exists tenant_all_companies on public.companies;
drop policy if exists tenant_all_regions on public.regions;
drop policy if exists tenant_all_transit_lines on public.transit_lines;
drop policy if exists tenant_all_map_points on public.map_points;

create policy tenant_all_companies on public.companies
  for all to anon, authenticated using (true) with check (true);
create policy tenant_all_regions on public.regions
  for all to anon, authenticated using (true) with check (true);
create policy tenant_all_transit_lines on public.transit_lines
  for all to anon, authenticated using (true) with check (true);
create policy tenant_all_map_points on public.map_points
  for all to anon, authenticated using (true) with check (true);
