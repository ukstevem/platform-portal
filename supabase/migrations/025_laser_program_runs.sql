-- Track individual program run completions in production
create table laser_program_run (
  id          serial primary key,
  quote_id    int not null references laser_quote on delete cascade,
  program_id  int not null references laser_program on delete cascade,
  run_number  int not null,
  status      text not null default 'pending'
              check (status in ('pending','complete','error','cancelled')),
  material_trace text,
  completed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (quote_id, program_id, run_number)
);

alter table laser_program_run enable row level security;

create policy "Authenticated users can read program runs"
  on laser_program_run for select to authenticated using (true);
create policy "Authenticated users can insert program runs"
  on laser_program_run for insert to authenticated with check (true);
create policy "Authenticated users can update program runs"
  on laser_program_run for update to authenticated using (true);
