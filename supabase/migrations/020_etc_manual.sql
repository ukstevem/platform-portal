-- Add manual Estimate to Complete (ETC) to project_items_commercial
alter table project_items_commercial
  add column if not exists etc_manual numeric(10,2);

-- ETC history log — tracks every PM estimate over time
create table if not exists project_etc_history (
  id              uuid primary key default gen_random_uuid(),
  project_item_id uuid not null references project_register_items(id) on delete cascade,
  projectnumber   text not null references project_register(projectnumber),
  item_seq        integer not null,
  etc_value       numeric(10,2) not null,
  entered_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists idx_project_etc_history_lookup
  on project_etc_history(projectnumber, item_seq, created_at);

alter table project_etc_history enable row level security;

create policy "Authenticated users can read project_etc_history"
  on project_etc_history for select to authenticated using (true);

create policy "Authenticated users can insert project_etc_history"
  on project_etc_history for insert to authenticated with check (true);
