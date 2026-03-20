-- Add overtime flag to timesheet entries
alter table timesheet_entries add column if not exists is_overtime boolean not null default false;
