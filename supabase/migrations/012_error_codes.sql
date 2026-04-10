-- Error code lookup table for document scanning

CREATE TABLE IF NOT EXISTS document_error_code (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  severity    text NOT NULL DEFAULT 'error' CHECK (severity IN ('error', 'warning', 'info')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed error codes
INSERT INTO document_error_code (code, label, description, severity) VALUES
  ('DUPLICATE_EXACT',   'Exact duplicate',       'The same file has already been uploaded and filed',                    'warning'),
  ('DUPLICATE_LOGICAL', 'Logical duplicate',      'A document for this asset, type and period has already been filed',   'warning'),
  ('NO_QR_CODE',        'No QR code found',       'No QR code could be detected on the first page of the document',     'error'),
  ('UNKNOWN_TYPE_CODE', 'Unknown type code',       'The type code from the QR is not in the filing rules',              'error'),
  ('UNKNOWN_ASSET',     'Unknown asset',           'The asset code from the QR is not in the asset register',           'error'),
  ('UNKNOWN_DOC_CODE',  'Unknown document code',   'The document code from the QR is not in document definitions',      'error'),
  ('DOC_TYPE_MISMATCH', 'Document type mismatch',  'The document code belongs to a different type code than the QR',    'error'),
  ('FILE_NOT_FOUND',    'File not found',          'The uploaded file could not be found in the inbox after upload',     'error'),
  ('PROCESSING_ERROR',  'Processing error',        'An unexpected error occurred during document processing',           'error')
ON CONFLICT (code) DO NOTHING;

-- Add error_code column to document_incoming_scan
ALTER TABLE document_incoming_scan
  ADD COLUMN IF NOT EXISTS error_code text REFERENCES document_error_code(code);

-- Index for filtering by error code
CREATE INDEX IF NOT EXISTS idx_scan_error_code ON document_incoming_scan (error_code)
  WHERE error_code IS NOT NULL;

-- Enable RLS
ALTER TABLE document_error_code ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read error codes
CREATE POLICY "error_codes_read" ON document_error_code
  FOR SELECT TO authenticated USING (true);
