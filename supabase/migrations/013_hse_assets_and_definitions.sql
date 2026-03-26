-- Rename CRANE-xx assets to CRN-xx
-- Update any existing scan references first
UPDATE document_incoming_scan SET asset_code = 'CRN-01' WHERE asset_code = 'CRANE-01';
UPDATE document_incoming_scan SET asset_code = 'CRN-02' WHERE asset_code = 'CRANE-02';
UPDATE document_incoming_scan SET asset_code = 'CRN-03' WHERE asset_code = 'CRANE-03';
UPDATE document_incoming_scan SET asset_code = 'CRN-04' WHERE asset_code = 'CRANE-04';
UPDATE document_incoming_scan SET asset_code = 'CRN-05' WHERE asset_code = 'CRANE-05';
UPDATE document_incoming_scan SET asset_code = 'CRN-06' WHERE asset_code = 'CRANE-06';
-- Then rename the assets
UPDATE asset_register SET asset_code = 'CRN-01' WHERE asset_code = 'CRANE-01';
UPDATE asset_register SET asset_code = 'CRN-02' WHERE asset_code = 'CRANE-02';
UPDATE asset_register SET asset_code = 'CRN-03' WHERE asset_code = 'CRANE-03';
UPDATE asset_register SET asset_code = 'CRN-04' WHERE asset_code = 'CRANE-04';
UPDATE asset_register SET asset_code = 'CRN-05' WHERE asset_code = 'CRANE-05';
UPDATE asset_register SET asset_code = 'CRN-06' WHERE asset_code = 'CRANE-06';

-- FLTs
INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('FLT-CAT-01',    'CAT Forklift 1',     'flt', 'Yard'),
  ('FLT-HYSTER-01', 'Hyster Forklift 1',  'flt', 'Yard')
ON CONFLICT (asset_code) DO NOTHING;

-- Fire extinguishers (FEX-01 through FEX-34)
INSERT INTO asset_register (asset_code, asset_name, category, location)
SELECT
  'FEX-' || LPAD(n::text, 2, '0'),
  'Fire Extinguisher ' || n,
  'fire-extinguisher',
  NULL
FROM generate_series(1, 34) AS n
ON CONFLICT (asset_code) DO NOTHING;

-- Machines (MCH-xx) — seed a few, add more as needed
INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('MCH-01', 'Machine 1', 'machine', NULL),
  ('MCH-02', 'Machine 2', 'machine', NULL),
  ('MCH-03', 'Machine 3', 'machine', NULL),
  ('MCH-04', 'Machine 4', 'machine', NULL),
  ('MCH-05', 'Machine 5', 'machine', NULL)
ON CONFLICT (asset_code) DO NOTHING;

-- SITE asset for whole-site inspections
INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('SITE', 'Whole Site', 'site', 'PSS')
ON CONFLICT (asset_code) DO NOTHING;

-- Document definitions
INSERT INTO document_definition (doc_code, doc_name, type_code, category, interval_days) VALUES
  -- Weekly safety walkround (whole site)
  ('WEEKLY-SAFETY',     'Weekly Safety Inspection',          'HS', 'site',              7),
  -- FLT pre-use checks
  ('FLT-PREUSE',        'FLT Weekly Pre-Use Check',         'HS', 'flt',               7),
  -- Fire extinguisher checks
  ('FEX-WEEKLY',        'Fire Extinguisher Weekly Check',    'HS', 'fire-extinguisher',  7),
  -- Contractor induction
  ('CONTRACTOR-INDUCT', 'Contractor Induction',             'HS', NULL,                 NULL),
  -- Vehicle weekly check
  ('VEH-WEEKLY',        'Weekly Vehicle Check',             'HS', 'vehicle',             7),
  -- HAVS disc usage
  ('HAVS-WEEKLY',       'HAVS Disc Usage Record',           'HS', NULL,                  7),
  -- Machine pre-op check
  ('MCH-PREOP',         'Machine Pre-Op Check',             'HS', 'machine',             7)
ON CONFLICT (doc_code) DO NOTHING;
