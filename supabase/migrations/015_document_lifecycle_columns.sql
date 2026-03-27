-- Additional columns for document lifecycle and traceability

-- Supersession links
ALTER TABLE document_incoming_scan
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES document_incoming_scan(id),
  ADD COLUMN IF NOT EXISTS supersedes    uuid REFERENCES document_incoming_scan(id);

-- Review/approval
ALTER TABLE document_incoming_scan
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- Free-text notes
ALTER TABLE document_incoming_scan
  ADD COLUMN IF NOT EXISTS notes text;

-- Index for finding supersession chains
CREATE INDEX IF NOT EXISTS idx_scan_superseded_by ON document_incoming_scan (superseded_by)
  WHERE superseded_by IS NOT NULL;
