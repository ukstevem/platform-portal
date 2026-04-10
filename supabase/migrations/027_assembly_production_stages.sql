-- Production stage tracking for assembly viewer nodes
create table stl_node_stage (
  id           serial primary key,
  run_id       text not null,
  node_id      text not null,
  stage        text not null default 'not_started'
               check (stage in ('not_started', 'on-order', 'stock', 'plating', 'welding', 'fabricated', 'paint', 'galv', 'delivered', 'installed')),
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (run_id, node_id)
);

alter table stl_node_stage enable row level security;

create policy "Authenticated users can read stages"
  on stl_node_stage for select to authenticated using (true);
create policy "Authenticated users can insert stages"
  on stl_node_stage for insert to authenticated with check (true);
create policy "Authenticated users can update stages"
  on stl_node_stage for update to authenticated using (true);

