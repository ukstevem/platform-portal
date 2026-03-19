-- ============================================================
-- Switch timesheet_entries from projectnumber to project_item
-- project_item = "projectnumber-item_seq" e.g. "10160-01"
-- Run this in your Supabase SQL editor
-- ============================================================

-- Add new column
alter table timesheet_entries add column if not exists project_item text;

-- Migrate existing data (if any rows have projectnumber set)
update timesheet_entries
  set project_item = projectnumber
  where project_item is null and projectnumber is not null;

-- Drop old constraints
alter table timesheet_entries drop constraint if exists timesheet_entries_projectnumber_fkey;
alter table timesheet_entries drop constraint if exists timesheet_entries_employee_id_projectnumber_work_date_key;

-- Drop old column
alter table timesheet_entries drop column if exists projectnumber;

-- Make project_item not null
alter table timesheet_entries alter column project_item set not null;

-- Add new unique constraint
alter table timesheet_entries add constraint timesheet_entries_employee_project_item_date_key
  unique(employee_id, project_item, work_date);

-- Update indexes
drop index if exists idx_timesheet_project_date;
create index if not exists idx_timesheet_project_item_date
  on timesheet_entries(project_item, work_date);
