-- ============================================================
-- Laser material grades — configurable material pricing
-- ============================================================

create table laser_material (
  id          serial primary key,
  material_class text not null check (material_class in ('MILD','STAINLESS','AL')),
  grade       text not null unique,
  rate        numeric not null,          -- £/tonne
  density     numeric,                   -- g/cm³ override (null = use class default)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Seed with the standard grades (matching existing laser_rate values)
insert into laser_material (material_class, grade, rate) values
  ('MILD',      'MILD',  950),
  ('STAINLESS', '304',   2850),
  ('STAINLESS', '316',   4000),
  ('AL',        'AL',    4300);

-- RLS
alter table laser_material enable row level security;

create policy "Authenticated users can read materials"
  on laser_material for select to authenticated using (true);
create policy "Authenticated users can insert materials"
  on laser_material for insert to authenticated with check (true);
create policy "Authenticated users can update materials"
  on laser_material for update to authenticated using (true);
