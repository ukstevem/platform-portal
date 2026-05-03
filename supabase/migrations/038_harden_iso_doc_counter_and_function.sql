-- Hardening pass after applying 036/037 to prod and running supabase advisors:
--
-- 1) iso61355_doc_number_counter was created in 036 without RLS enabled (the
--    other iso61355_* tables had it from 030, but the counter was added later
--    and missed). Service-role only access, no policies — same pattern as
--    document_app_* tables.
--
-- 2) mint_iso_doc_serial (from 037) had a mutable search_path which Supabase's
--    linter flags as a search_path-injection risk. Pin to public so a hostile
--    search_path on the calling session can't trick the function into using a
--    table from a different schema.

alter table iso61355_doc_number_counter enable row level security;

create or replace function mint_iso_doc_serial(
  p_reference     text,
  p_tech_area_id  int,
  p_subclass_id   int
) returns int
language sql
set search_path = public
as $$
  insert into iso61355_doc_number_counter
    (reference, iso_tech_area_id, iso_subclass_id, last_serial)
  values
    (p_reference, p_tech_area_id, p_subclass_id, 1)
  on conflict (reference, iso_tech_area_id, iso_subclass_id)
  do update set
    last_serial = iso61355_doc_number_counter.last_serial + 1,
    updated_at  = now()
  returning last_serial;
$$;

revoke all on function mint_iso_doc_serial(text, int, int) from public;
grant execute on function mint_iso_doc_serial(text, int, int) to service_role;
