-- Add file hash for exact duplicate detection, thumbnail path, and expand status for duplicate flagging

-- Add file_hash column
ALTER TABLE document_incoming_scan
  ADD COLUMN IF NOT EXISTS file_hash text;

-- Add thumbnail_path column
ALTER TABLE document_incoming_scan
  ADD COLUMN IF NOT EXISTS thumbnail_path text;

-- Create index on file_hash for fast duplicate lookups
CREATE INDEX IF NOT EXISTS idx_scan_file_hash ON document_incoming_scan (file_hash);

-- Create composite index for logical duplicate detection (QR content + period)
CREATE INDEX IF NOT EXISTS idx_scan_logical_dedup
  ON document_incoming_scan (asset_code, doc_code, type_code, period)
  WHERE status = 'filed';

-- Expand status check to include 'duplicate'
ALTER TABLE document_incoming_scan
  DROP CONSTRAINT IF EXISTS document_incoming_scan_status_check;

ALTER TABLE document_incoming_scan
  ADD CONSTRAINT document_incoming_scan_status_check
  CHECK (status IN ('queued', 'scanning', 'filed', 'error', 'duplicate'));
