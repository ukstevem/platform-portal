-- Run this in the Supabase SQL editor to create the nesting_jobs table

create table if not exists nesting_jobs (
  id              uuid primary key default gen_random_uuid(),
  project_number  text,
  task_id         text not null,
  status          text not null default 'running',
  request_payload jsonb not null,
  result_summary  jsonb,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

-- Index for listing by project
create index if not exists idx_nesting_jobs_project
  on nesting_jobs (project_number, created_at desc);

-- RLS
alter table nesting_jobs enable row level security;

create policy "Authenticated users can read all nesting jobs"
  on nesting_jobs for select
  to authenticated
  using (true);

create policy "Authenticated users can insert nesting jobs"
  on nesting_jobs for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update nesting jobs"
  on nesting_jobs for update
  to authenticated
  using (true);

-- If you already created the table without the status column, run:
-- alter table nesting_jobs add column if not exists status text not null default 'running';
