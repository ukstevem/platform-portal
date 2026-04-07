-- Free issue margin rate
insert into laser_rate (key, value, unit, label) values
  ('margin_free_issue', 0.30, '', 'Free Issue Material Margin');

-- Add free_issue flag to laser_import
alter table laser_import add column free_issue boolean not null default false;
