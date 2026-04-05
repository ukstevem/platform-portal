-- Add run_count to laser_program (how many times this program is run)
alter table laser_program add column run_count int not null default 1;

-- Allow authenticated users to update programs (needed for run_count edits)
create policy "Authenticated users can update programs"
  on laser_program for update to authenticated using (true);
