-- ============================================================
-- Add labour & materials estimates to project_register_items
-- ============================================================

alter table project_register_items
  add column if not exists est_labour numeric(10,2) not null default 0,
  add column if not exists est_materials numeric(10,2) not null default 0;

-- Allow authenticated users to update project_register_items (for estimates)
create policy "Authenticated users can update project_register_items"
  on project_register_items
  for update
  to authenticated
  using (true);
