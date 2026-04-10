-- Adopt new naming convention: {CATEGORY}-{SUBTYPE}-{###}
-- Update existing assets, add new assets, add new document definitions

-- ============================================================
-- 1. Rename existing crane assets: CRANE-XX → MCH-CRN-00X
-- ============================================================
-- Must update document_incoming_scan FK references first
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-001' WHERE asset_code = 'CRANE-01';
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-002' WHERE asset_code = 'CRANE-02';
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-003' WHERE asset_code = 'CRANE-03';
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-004' WHERE asset_code = 'CRANE-04';
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-005' WHERE asset_code = 'CRANE-05';
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-006' WHERE asset_code = 'CRANE-06';

UPDATE asset_register SET asset_code = 'MCH-CRN-001', category = 'machine' WHERE asset_code = 'CRANE-01';
UPDATE asset_register SET asset_code = 'MCH-CRN-002', category = 'machine' WHERE asset_code = 'CRANE-02';
UPDATE asset_register SET asset_code = 'MCH-CRN-003', category = 'machine' WHERE asset_code = 'CRANE-03';
UPDATE asset_register SET asset_code = 'MCH-CRN-004', category = 'machine' WHERE asset_code = 'CRANE-04';
UPDATE asset_register SET asset_code = 'MCH-CRN-005', category = 'machine' WHERE asset_code = 'CRANE-05';
UPDATE asset_register SET asset_code = 'MCH-CRN-006', category = 'machine' WHERE asset_code = 'CRANE-06';

-- ============================================================
-- 2. New machine assets
-- ============================================================
INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('MCH-DRL-001', 'Drill',              'machine', NULL),
  ('MCH-GRN-001', 'Grinder',            'machine', NULL),
  ('MCH-PRB-001', 'Press Brake',        'machine', NULL),
  ('MCH-GIL-001', 'Guillotine',         'machine', NULL),
  ('MCH-SAW-001', 'Saw 1',              'machine', NULL),
  ('MCH-SAW-002', 'Saw 2',              'machine', NULL)
ON CONFLICT (asset_code) DO NOTHING;

-- ============================================================
-- 3. Vehicle assets
-- ============================================================
INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('VEH-FLT-001', 'CAT Forklift',       'vehicle', NULL),
  ('VEH-FLT-002', 'Hyster Forklift',    'vehicle', NULL),
  ('VEH-VAN-001', 'Van 1',              'vehicle', NULL),
  ('VEH-VAN-002', 'Van 2',              'vehicle', NULL),
  ('VEH-VAN-003', 'Van 3',              'vehicle', NULL),
  ('VEH-VAN-004', 'Van 4',              'vehicle', NULL),
  ('VEH-UTE-001', 'Pickup 1',           'vehicle', NULL),
  ('VEH-UTE-002', 'Pickup 2',           'vehicle', NULL),
  ('VEH-UTE-003', 'Pickup 3',           'vehicle', NULL),
  ('VEH-UTE-004', 'Pickup 4',           'vehicle', NULL)
ON CONFLICT (asset_code) DO NOTHING;

-- ============================================================
-- 4. HSE form assets (site-level forms, not tied to a machine)
-- ============================================================
INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('HS-CAR-001', 'Weekly Safety Inspection (Carrwood Rd)', 'hse-form', 'Carrwood Rd'),
  ('HS-FEX-001', 'Fire Extinguisher Weekly Check',        'hse-form', NULL),
  ('HS-HAV-001', 'HAVS Disc Usage Record',                'hse-form', NULL),
  ('HS-CON-001', 'Contractor Induction',                  'hse-form', NULL),
  ('HS-AEI-001', 'Adverse Event Investigation',           'hse-form', NULL)
ON CONFLICT (asset_code) DO NOTHING;

-- ============================================================
-- 5. Fire extinguisher assets
-- ============================================================
INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('FEX-FOA-001', 'Foam Extinguisher 1',  'fire-extinguisher', NULL),
  ('FEX-CO2-001', 'CO2 Extinguisher 1',   'fire-extinguisher', NULL),
  ('FEX-CO2-002', 'CO2 Extinguisher 2',   'fire-extinguisher', NULL)
ON CONFLICT (asset_code) DO NOTHING;

-- ============================================================
-- 6. Remove old SITE asset if it exists
-- ============================================================
UPDATE asset_register SET active = false WHERE asset_code = 'SITE';

-- ============================================================
-- 7. New document definitions
-- ============================================================
INSERT INTO document_definition (doc_code, doc_name, type_code, category, interval_days) VALUES
  ('WEEKLY-SAFETY',       'Weekly Safety Inspection',        'HS', 'hse-form',  7),
  ('FLT-PREUSE',          'FLT Weekly Pre-Use Check',        'HS', 'vehicle',   7),
  ('FEX-WEEKLY',          'Fire Extinguisher Weekly Check',   'HS', 'fire-extinguisher', 7),
  ('CONTRACTOR-INDUCT',   'Contractor Induction',            'HS', 'hse-form',  NULL),
  ('VEH-WEEKLY',          'Weekly Vehicle Check',            'HS', 'vehicle',   7),
  ('HAVS-WEEKLY',         'HAVS Disc Usage Record',          'HS', 'hse-form',  7),
  ('MCH-PREOP',           'Machine Pre-Op Check',            'HS', 'machine',   1),
  ('AEI',                 'Adverse Event Investigation',     'HS', 'hse-form',  NULL)
ON CONFLICT (doc_code) DO NOTHING;
