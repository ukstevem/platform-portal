-- Add production workflow statuses to laser_quote
alter table laser_quote drop constraint laser_quote_status_check;
alter table laser_quote add constraint laser_quote_status_check
  check (status in ('draft','issued','revised','won','completed','ready_for_collection','delivered','error','cancelled','lost'));
