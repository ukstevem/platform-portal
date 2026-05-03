-- Rename the "asset" terminology to "subject" to remove the overload.
-- "Asset" was being used for two distinct concepts: physical things (machines,
-- vehicles, sites, extinguishers) AND form/document types (preuse forms etc.).
-- Going forward: physical/logical things being documented = "subject"; document
-- types = doc_code (or ISO 61355 description). See bd issue weo for context.
--
-- This is a pure rename migration — no data changes, no schema shape changes.
-- All FK relationships, indexes, and triggers follow the renames automatically;
-- explicit ALTERs below just keep the names tidy.
--
-- Calling apps must be updated to use the new names in lockstep with this
-- migration. Affected: pss-document-service, platform-portal/apps/scanner,
-- pss-matl-cert.

-- 1. Rename the table.
alter table asset_register rename to subject_register;

-- 2. Rename the natural business key column.
alter table subject_register rename column asset_code to subject_code;

-- 3. Rename auto-generated constraints to match.
alter table subject_register
  rename constraint asset_register_asset_code_key to subject_register_subject_code_key;

-- Rename the CHECK constraint added in migration 010 (its expression already
-- updates to point at the renamed column; only the constraint name is stale).
alter table subject_register
  rename constraint chk_asset_code_no_underscore to chk_subject_code_no_underscore;

-- Rename the auto-generated FK constraint on subject_register.doc_code (added by
-- a later migration referencing document_definition).
alter table subject_register
  rename constraint asset_register_doc_code_fkey to subject_register_doc_code_fkey;

-- 4. Rename indexes (Postgres auto-renames the PK index in most versions but
-- being explicit avoids version drift).
alter index asset_register_pkey rename to subject_register_pkey;
alter index idx_asset_register_category rename to idx_subject_register_category;

-- 5. Rename the column on document_incoming_scan + its FK constraint.
alter table document_incoming_scan rename column asset_code to subject_code;

alter table document_incoming_scan
  rename constraint document_incoming_scan_asset_code_fkey
  to document_incoming_scan_subject_code_fkey;

-- Note: the logical-dedup index idx_scan_logical_dedup references the old column
-- name in its definition; Postgres auto-updates it to the new column, no action
-- needed. Same for any other column-referencing objects.

-- 6. Rename the 'asset_code' key inside override_metadata jsonb blobs (used by
-- the refile flow) to 'subject_code' so the worker/processor read the right
-- field after the code rename. Touches only rows where the old key is present.
update document_incoming_scan
set override_metadata =
      (override_metadata - 'asset_code')
      || jsonb_build_object('subject_code', override_metadata -> 'asset_code')
where override_metadata ? 'asset_code';
