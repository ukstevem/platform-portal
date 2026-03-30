-- Add meta_required flag to document_definition
ALTER TABLE document_definition
  ADD COLUMN IF NOT EXISTS meta_required boolean NOT NULL DEFAULT false;

-- Mark contractor induction as requiring metadata
UPDATE document_definition SET meta_required = true WHERE doc_code = 'CONTRACTOR-INDUCT';

-- Document definition metadata requirements
CREATE TABLE IF NOT EXISTS document_definition_meta (
  id              serial PRIMARY KEY,
  doc_code        text NOT NULL REFERENCES document_definition(doc_code),
  field_name      text NOT NULL,          -- key in override_metadata JSON
  field_label     text NOT NULL,          -- UI label
  field_type      text NOT NULL DEFAULT 'text'
                  CHECK (field_type IN ('text', 'date', 'select', 'supplier', 'supplier_employees')),
  required        boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 0,
  UNIQUE (doc_code, field_name)
);

-- Seed: contractor induction requires supplier + employees
INSERT INTO document_definition_meta (doc_code, field_name, field_label, field_type, required, sort_order) VALUES
  ('CONTRACTOR-INDUCT', 'supplier_id',   'Supplier / Contractor', 'supplier',           true, 1),
  ('CONTRACTOR-INDUCT', 'employee_ids',  'Employees Inducted',    'supplier_employees', true, 2)
ON CONFLICT (doc_code, field_name) DO NOTHING;

-- Supplier employees table
CREATE TABLE IF NOT EXISTS supplier_employee (
  id              serial PRIMARY KEY,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id),
  employee_name   text NOT NULL,
  induction_date  date,
  induction_scan_id uuid REFERENCES document_incoming_scan(id),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_supplier_employee_supplier ON supplier_employee (supplier_id);

-- Add META_REQUIRED error code
INSERT INTO document_error_code (code, label, description, severity) VALUES
  ('META_REQUIRED', 'Additional information required', 'This document type requires metadata that cannot be read from the QR code', 'warning')
ON CONFLICT (code) DO NOTHING;

-- RLS
ALTER TABLE document_definition_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_employee ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read definition meta"
  ON document_definition_meta FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can read supplier employees"
  ON supplier_employee FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage supplier employees"
  ON supplier_employee FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
