-- Stage key lookup table
create table stl_stage_key (
  id           serial primary key,
  key          text unique not null,
  label        text not null,
  mesh_color   text not null,
  dot_class    text not null,
  sort_order   int not null default 0
);

-- Seed the initial stages
insert into stl_stage_key (key, label, mesh_color, dot_class, sort_order) values
  ('bought_out',  'Bought Out',  '0x78716c', 'bg-stone-500',  0),
  ('not_started', 'Not Started', '0xbbbbbb', 'bg-gray-400',   1),
  ('on_order',    'On Order',    '0xf97316', 'bg-orange-500',  2),
  ('stock',       'Stock',       '0x06b6d4', 'bg-cyan-500',    3),
  ('plating',     'Plating',     '0xeab308', 'bg-yellow-500',  4),
  ('welding',     'Welding',     '0xef4444', 'bg-red-500',     5),
  ('fabricated',  'Fabricated',  '0x3b82f6', 'bg-blue-500',    6),
  ('paint',       'Paint',       '0x8b5cf6', 'bg-violet-500',  7),
  ('galv',        'Galv',        '0x94a3b8', 'bg-slate-400',   8),
  ('delivered',   'Delivered',   '0x6366f1', 'bg-indigo-500',  9),
  ('installed',   'Installed',   '0x22c55e', 'bg-green-500',  10);

alter table stl_stage_key enable row level security;
create policy "Anyone can read stage keys"
  on stl_stage_key for select using (true);

-- One row per node instance — timestamp columns for each stage
create table stl_node_stage (
  id              serial primary key,
  run_id          text not null,
  node_id         text not null,
  bought_out_at   timestamptz,
  not_started_at  timestamptz,
  on_order_at     timestamptz,
  stock_at        timestamptz,
  plating_at      timestamptz,
  welding_at      timestamptz,
  fabricated_at   timestamptz,
  paint_at        timestamptz,
  galv_at         timestamptz,
  delivered_at    timestamptz,
  installed_at    timestamptz,
  updated_by      uuid references auth.users(id),
  unique (run_id, node_id)
);

alter table stl_node_stage enable row level security;

create policy "Authenticated users can read stages"
  on stl_node_stage for select to authenticated using (true);
create policy "Authenticated users can insert stages"
  on stl_node_stage for insert to authenticated with check (true);
create policy "Authenticated users can update stages"
  on stl_node_stage for update to authenticated using (true);
create policy "Authenticated users can delete stages"
  on stl_node_stage for delete to authenticated using (true);
