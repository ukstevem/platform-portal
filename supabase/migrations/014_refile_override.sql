-- Support for refiling quarantined scans with manual metadata overrides

-- JSONB column for override metadata (type_code, asset_code, doc_code, period, skip_duplicate_check)
ALTER TABLE document_incoming_scan
  ADD COLUMN IF NOT EXISTS override_metadata jsonb;

-- Document lifecycle columns (separate from processing status)
ALTER TABLE document_incoming_scan
  ADD COLUMN IF NOT EXISTS lifecycle_status text CHECK (lifecycle_status IN ('active', 'superseded', 'deactivated', 'archived')),
  ADD COLUMN IF NOT EXISTS lifecycle_reason text,
  ADD COLUMN IF NOT EXISTS lifecycle_at     timestamptz;

CREATE INDEX IF NOT EXISTS idx_scan_lifecycle ON document_incoming_scan (lifecycle_status)
  WHERE lifecycle_status IS NOT NULL;
