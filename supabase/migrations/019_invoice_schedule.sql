-- ============================================================
-- Project Invoice Schedule (revenue milestones to customer)
-- ============================================================

create table if not exists project_invoice_schedule (
  id                uuid primary key default gen_random_uuid(),
  project_item_id   uuid not null references project_register_items(id) on delete cascade,
  projectnumber     text not null references project_register(projectnumber),
  item_seq          integer not null,
  milestone         text not null,
  planned_date      date,
  planned_amount    numeric(10,2) not null default 0,
  invoiced          boolean not null default false,
  invoice_reference text,
  actual_date       date,
  actual_amount     numeric(10,2),
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_project_invoice_schedule_project
  on project_invoice_schedule(projectnumber, item_seq);

-- RLS
alter table project_invoice_schedule enable row level security;

create policy "Authenticated users can read project_invoice_schedule"
  on project_invoice_schedule for select to authenticated using (true);

create policy "Authenticated users can insert project_invoice_schedule"
  on project_invoice_schedule for insert to authenticated with check (true);

create policy "Authenticated users can update project_invoice_schedule"
  on project_invoice_schedule for update to authenticated using (true);

create policy "Authenticated users can delete project_invoice_schedule"
  on project_invoice_schedule for delete to authenticated using (true);

-- Updated_at trigger
drop trigger if exists trg_project_invoice_schedule_updated_at on project_invoice_schedule;
create trigger trg_project_invoice_schedule_updated_at
  before update on project_invoice_schedule
  for each row execute function set_updated_at();
