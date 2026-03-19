-- ============================================================
-- Timesheets: employees + timesheet_entries
-- Run this in your Supabase SQL editor
-- ============================================================

-- Employees table
create table if not exists employees (
  id            uuid primary key default gen_random_uuid(),
  first_name    text not null,
  last_name     text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Timesheet entries: one row per employee / project_item / date
-- project_item = "projectnumber-item_seq" e.g. "10160-01"
create table if not exists timesheet_entries (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  project_item  text not null,
  work_date     date not null,
  hours         numeric(4,2) not null default 0,
  entered_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(employee_id, project_item, work_date)
);

-- Indexes for common queries
create index if not exists idx_timesheet_employee_date
  on timesheet_entries(employee_id, work_date);

create index if not exists idx_timesheet_project_item_date
  on timesheet_entries(project_item, work_date);

-- ============================================================
-- Row-Level Security
-- ============================================================

alter table employees enable row level security;
alter table timesheet_entries enable row level security;

-- Drop existing policies if re-running
drop policy if exists "Authenticated users can read employees" on employees;
drop policy if exists "Authenticated users can insert employees" on employees;
drop policy if exists "Authenticated users can update employees" on employees;
drop policy if exists "Authenticated users can read timesheet_entries" on timesheet_entries;
drop policy if exists "Authenticated users can insert timesheet_entries" on timesheet_entries;
drop policy if exists "Authenticated users can update timesheet_entries" on timesheet_entries;
drop policy if exists "Authenticated users can delete timesheet_entries" on timesheet_entries;

create policy "Authenticated users can read employees"
  on employees for select to authenticated using (true);

create policy "Authenticated users can insert employees"
  on employees for insert to authenticated with check (true);

create policy "Authenticated users can update employees"
  on employees for update to authenticated using (true);

create policy "Authenticated users can read timesheet_entries"
  on timesheet_entries for select to authenticated using (true);

create policy "Authenticated users can insert timesheet_entries"
  on timesheet_entries for insert to authenticated with check (true);

create policy "Authenticated users can update timesheet_entries"
  on timesheet_entries for update to authenticated using (true);

create policy "Authenticated users can delete timesheet_entries"
  on timesheet_entries for delete to authenticated using (true);

-- Updated_at trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_employees_updated_at on employees;
create trigger trg_employees_updated_at
  before update on employees
  for each row execute function set_updated_at();

drop trigger if exists trg_timesheet_entries_updated_at on timesheet_entries;
create trigger trg_timesheet_entries_updated_at
  before update on timesheet_entries
  for each row execute function set_updated_at();
