-- ============================================================
-- Wage Preparation
-- ============================================================
-- Naming convention (new tables):
--   acc_  = Accounts domain
--   auth_ = Authentication / user management
--   prj_  = Projects domain
--   ts_   = Timesheets domain (existing tables predate this convention)

-- Add payroll_id and team to employees
alter table employees add column if not exists payroll_id text;
alter table employees add column if not exists team text not null default 'shop';
-- team: 'shop' or 'site'

-- acc_wage_prep: manual wage entries per employee per week
create table if not exists acc_wage_prep (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  week_start    date not null,  -- Monday of the week
  travel_hours  numeric(6,2) not null default 0,
  bonus         numeric(8,2) not null default 0,
  subs          numeric(8,2) not null default 0,
  furlough_hours numeric(6,2) not null default 0,
  comments      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(employee_id, week_start)
);

create index if not exists idx_acc_wage_prep_employee_week
  on acc_wage_prep(employee_id, week_start);

-- RLS
alter table acc_wage_prep enable row level security;

create policy "Authenticated users can read acc_wage_prep"
  on acc_wage_prep for select to authenticated using (true);

create policy "Authenticated users can insert acc_wage_prep"
  on acc_wage_prep for insert to authenticated with check (true);

create policy "Authenticated users can update acc_wage_prep"
  on acc_wage_prep for update to authenticated using (true);

create policy "Authenticated users can delete acc_wage_prep"
  on acc_wage_prep for delete to authenticated using (true);

-- Updated_at trigger
drop trigger if exists trg_acc_wage_prep_updated_at on acc_wage_prep;
create trigger trg_acc_wage_prep_updated_at
  before update on acc_wage_prep
  for each row execute function set_updated_at();

-- auth_user_roles: platform-wide role assignments
create table if not exists auth_user_roles (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'user',  -- 'admin', 'manager', 'user'
  unique(user_id)
);

alter table auth_user_roles enable row level security;

create policy "Authenticated users can read auth_user_roles"
  on auth_user_roles for select to authenticated using (true);

create policy "Admins can manage auth_user_roles"
  on auth_user_roles for all to authenticated using (true);
