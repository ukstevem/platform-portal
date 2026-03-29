-- ============================================================
-- Project Items Commercial Data (EVM and cost tracking)
-- ============================================================
-- Naming convention: prj_ = Projects domain
-- One row per project item, referencing project_register_items

create table if not exists project_items_commercial (
  id                      uuid primary key default gen_random_uuid(),
  project_item_id         uuid not null references project_register_items(id) on delete cascade,
  projectnumber           text not null,
  item_seq                integer not null,
  pct_complete            integer not null default 0,        -- manual 0-100
  planned_start_date      date,
  planned_completion_date date,
  actual_start_date       date,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique(project_item_id),
  unique(projectnumber, item_seq)
);

create index if not exists idx_project_items_commercial_project
  on project_items_commercial(projectnumber, item_seq);

-- RLS
alter table project_items_commercial enable row level security;

create policy "Authenticated users can read project_items_commercial"
  on project_items_commercial for select to authenticated using (true);

create policy "Authenticated users can insert project_items_commercial"
  on project_items_commercial for insert to authenticated with check (true);

create policy "Authenticated users can update project_items_commercial"
  on project_items_commercial for update to authenticated using (true);

create policy "Authenticated users can delete project_items_commercial"
  on project_items_commercial for delete to authenticated using (true);

-- Updated_at trigger
drop trigger if exists trg_project_items_commercial_updated_at on project_items_commercial;
create trigger trg_project_items_commercial_updated_at
  before update on project_items_commercial
  for each row execute function set_updated_at();
