-- Atomic minter for ISO 61355 document serials.
--
-- Concurrent calls for the same (reference, DCC) get distinct serials because
-- INSERT ... ON CONFLICT DO UPDATE acquires a row-level lock and runs as a
-- single statement.
--
-- Called from the doc service via supabase.rpc('mint_iso_doc_serial', ...).
-- Stored as SQL (not plpgsql) for the simplest possible plan.

create or replace function mint_iso_doc_serial(
  p_reference     text,
  p_tech_area_id  int,
  p_subclass_id   int
) returns int
language sql
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

-- Allow service_role to call it. Anon/authenticated have no business minting
-- doc numbers — only the doc service backend should.
revoke all on function mint_iso_doc_serial(text, int, int) from public;
grant execute on function mint_iso_doc_serial(text, int, int) to service_role;
