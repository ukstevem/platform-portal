-- Add meta_required flag to document_definition

ALTER TABLE document_definition
  ADD COLUMN IF NOT EXISTS meta_required boolean NOT NULL DEFAULT false;

-- CONTRACTOR-INDUCT requires additional metadata (supplier, employees)
UPDATE document_definition
  SET meta_required = true
  WHERE doc_code = 'CONTRACTOR-INDUCT';

-- Add META_REQUIRED error code if not already present
INSERT INTO document_error_code (code, label, description, severity) VALUES
  ('META_REQUIRED', 'Additional info required', 'This document requires additional information before filing', 'warning')
ON CONFLICT (code) DO NOTHING;

-- Add meta column to document_incoming_scan for storing additional metadata
ALTER TABLE document_incoming_scan
  ADD COLUMN IF NOT EXISTS meta jsonb;
