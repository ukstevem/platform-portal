-- Add completed status to project_register_items
alter table project_register_items
  add column if not exists completed boolean not null default false,
  add column if not exists completed_at timestamptz;
