-- Asset register: central registry of assets referenced by QR-coded documents

create table if not exists asset_register (
  id            serial primary key,
  asset_code    text        not null unique,   -- short code used in QR (e.g. 'CRANE-01')
  asset_name    text        not null,          -- human-readable name
  category      text        not null,          -- grouping: 'crane', 'welding-bay', 'vehicle', 'vessel', 'project'
  location      text,                          -- site, bay, yard, etc.
  manufacturer  text,
  model         text,
  serial_number text,
  notes         text,
  active        boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_asset_register_category on asset_register (category);

-- Seed: example crane fleet
insert into asset_register (asset_code, asset_name, category, location) values
  ('CRANE-01', 'Saw Shop North',  'crane', 'Bay 1'),
  ('CRANE-02', 'Saw Shop South',  'crane', 'Bay 1'),
  ('CRANE-03', 'Fab Shop North',  'crane', 'Bay 2'),
  ('CRANE-04', 'Fab Shop South',  'crane', 'Bay 2'),
  ('CRANE-05', 'Basket Shop North',  'crane', 'Bay 3'),
  ('CRANE-06', 'Basket Shop South',  'crane', 'Bay 3')
on conflict (asset_code) do nothing;

-- Add asset + period columns to document_incoming_scan
alter table document_incoming_scan
  add column if not exists asset_code text references asset_register(asset_code),
  add column if not exists period     text;   -- auto-derived: '2026-W13', '2026-03-24', etc.

-- RLS
alter table asset_register enable row level security;

create policy "Authenticated users can read assets"
  on asset_register for select
  to authenticated using (true);

create policy "Authenticated users can manage assets"
  on asset_register for all
  to authenticated using (true) with check (true);
