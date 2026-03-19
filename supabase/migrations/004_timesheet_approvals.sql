-- Timesheet weekly approvals
-- Tracks manager sign-off per employee per week

create table if not exists timesheet_approvals (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  week_start    date not null,  -- Monday of the approved week
  approved_by   uuid not null references auth.users(id),
  approved_at   timestamptz not null default now(),
  unique(employee_id, week_start)
);

create index if not exists idx_approval_employee_week
  on timesheet_approvals(employee_id, week_start);

-- RLS
alter table timesheet_approvals enable row level security;

create policy "Authenticated users can read timesheet_approvals"
  on timesheet_approvals for select to authenticated using (true);

create policy "Authenticated users can insert timesheet_approvals"
  on timesheet_approvals for insert to authenticated with check (true);

create policy "Authenticated users can delete timesheet_approvals"
  on timesheet_approvals for delete to authenticated using (true);
