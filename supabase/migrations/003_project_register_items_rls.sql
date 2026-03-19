-- Allow authenticated users to read project_register_items
alter table project_register_items enable row level security;

create policy "Authenticated users can read project_register_items"
  on project_register_items
  for select
  to authenticated
  using (true);
