-- ============================================================
-- LaserQuote: laser cutting pricing & quoting
-- ============================================================

-- Configurable rates (burden, densities, material prices, margins)
create table laser_rate (
  id          serial primary key,
  key         text   not null unique,
  value       numeric not null,
  unit        text,
  label       text   not null,
  updated_at  timestamptz not null default now()
);

insert into laser_rate (key, value, unit, label) values
  ('burden_rate',       162,    '£/hr',    'Machine Burden Rate'),
  ('density_mild',      7.85,   'g/cm³',   'Density – Mild Steel'),
  ('density_stainless', 8.0,    'g/cm³',   'Density – Stainless Steel'),
  ('density_al',        2.7,    'g/cm³',   'Density – Aluminium'),
  ('rate_mild',         950,    '£/tonne', 'Material Rate – Mild'),
  ('rate_304',          2850,   '£/tonne', 'Material Rate – 304 SS'),
  ('rate_316',          4000,   '£/tonne', 'Material Rate – 316 SS'),
  ('rate_al',           4300,   '£/tonne', 'Material Rate – Aluminium'),
  ('min_handling',      30,     '£',       'Minimum Handling Charge'),
  ('min_threshold',     200,    '£',       'Minimum Cost Threshold'),
  ('margin_standard',   0.35,   '',        'Standard Margin'),
  ('margin_premium',    0.75,   '',        'Premium Margin'),
  ('margin_pss',        0.10,   '',        'PSS Internal Margin');

-- Import batch (one upload event, may contain multiple CSV files)
create table laser_import (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'queued'
                  check (status in ('queued','processing','complete','error')),
  error_message   text,
  file_count      int not null default 0,
  customer        text,
  material        text check (material in ('MILD','STAINLESS','AL')),
  grade           text,
  sheet_price     numeric,
  material_rate   numeric,
  premium         boolean not null default false,
  rem_charge      boolean not null default false,
  uploaded_by     uuid references auth.users,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One row per CSV file / nest program
create table laser_program (
  id              serial primary key,
  import_id       uuid not null references laser_import on delete cascade,
  program_name    text not null,
  nesting_name    text,
  material_code   text,
  thickness       numeric,
  strategy        text,
  nozzle_diameter text,
  bounding_box_x  int,
  bounding_box_y  int,
  sheet_count     int not null default 1,
  sheet_x         int,
  sheet_y         int,
  runtime_seconds int,
  utilisation     numeric,
  file_name       text,
  created_at      timestamptz not null default now()
);

-- Parts parsed from each program
create table laser_part (
  id                serial primary key,
  program_id        int not null references laser_program on delete cascade,
  part_name         text not null,
  nest_id           int,
  bounding_x        int,
  bounding_y        int,
  quantity          int not null default 1,
  area              numeric,
  area_incl_holes   numeric,
  cutting_length    numeric,
  runtime_seconds   int,
  weight            numeric,
  created_at        timestamptz not null default now()
);

-- Quotes
create table laser_quote (
  id              serial primary key,
  quote_number    int not null unique,
  import_id       uuid references laser_import,
  customer        text not null,
  material        text,
  grade           text,
  thickness       numeric,
  incoterms       text,
  lead_time       text,
  status          text not null default 'draft'
                  check (status in ('draft','issued','revised')),
  pdf_path        text,
  total_value     numeric,
  created_by      uuid references auth.users,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Quote line items (aggregated across programs)
create table laser_quote_line (
  id                    serial primary key,
  quote_id              int not null references laser_quote on delete cascade,
  line_number           int not null,
  part_name             text not null,
  quantity              int not null,
  bounding_size         text,
  material              text,
  grade                 text,
  thickness             numeric,
  mass_each             numeric,
  material_cost_each    numeric,
  runtime_seconds_each  numeric,
  runtime_cost          numeric,
  handling_cost         numeric,
  total_cost            numeric,
  margin                numeric,
  unit_price            numeric,
  line_price            numeric,
  created_at            timestamptz not null default now()
);

-- Sequence for quote numbers (starting after existing Excel quotes)
create sequence laser_quote_number_seq start with 70000;

-- RLS policies
alter table laser_rate enable row level security;
alter table laser_import enable row level security;
alter table laser_program enable row level security;
alter table laser_part enable row level security;
alter table laser_quote enable row level security;
alter table laser_quote_line enable row level security;

create policy "Authenticated users can read rates"
  on laser_rate for select to authenticated using (true);
create policy "Authenticated users can update rates"
  on laser_rate for update to authenticated using (true);

create policy "Authenticated users can read imports"
  on laser_import for select to authenticated using (true);
create policy "Authenticated users can insert imports"
  on laser_import for insert to authenticated with check (true);
create policy "Authenticated users can update imports"
  on laser_import for update to authenticated using (true);

create policy "Authenticated users can read programs"
  on laser_program for select to authenticated using (true);
create policy "Authenticated users can insert programs"
  on laser_program for insert to authenticated with check (true);

create policy "Authenticated users can read parts"
  on laser_part for select to authenticated using (true);
create policy "Authenticated users can insert parts"
  on laser_part for insert to authenticated with check (true);

create policy "Authenticated users can read quotes"
  on laser_quote for select to authenticated using (true);
create policy "Authenticated users can insert quotes"
  on laser_quote for insert to authenticated with check (true);
create policy "Authenticated users can update quotes"
  on laser_quote for update to authenticated using (true);

create policy "Authenticated users can read quote lines"
  on laser_quote_line for select to authenticated using (true);
create policy "Authenticated users can insert quote lines"
  on laser_quote_line for insert to authenticated with check (true);
