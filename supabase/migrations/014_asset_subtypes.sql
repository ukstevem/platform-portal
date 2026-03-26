-- Update assets with proper subtypes per ISO-aligned naming convention
-- Format: {CATEGORY}-{SUBTYPE}-{SEQ ###}
-- Categories: MCH (machines/plant), VEH (vehicles), HSE (site forms), FEX (fire extinguishers)

-- ─── CRANES: CRN-xx → MCH-CRN-xxx ───
-- Rename assets first (FK target), then scan references
UPDATE asset_register SET asset_code = 'MCH-CRN-001', category = 'machine' WHERE asset_code = 'CRN-01';
UPDATE asset_register SET asset_code = 'MCH-CRN-002', category = 'machine' WHERE asset_code = 'CRN-02';
UPDATE asset_register SET asset_code = 'MCH-CRN-003', category = 'machine' WHERE asset_code = 'CRN-03';
UPDATE asset_register SET asset_code = 'MCH-CRN-004', category = 'machine' WHERE asset_code = 'CRN-04';
UPDATE asset_register SET asset_code = 'MCH-CRN-005', category = 'machine' WHERE asset_code = 'CRN-05';
UPDATE asset_register SET asset_code = 'MCH-CRN-006', category = 'machine' WHERE asset_code = 'CRN-06';

UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-001' WHERE asset_code = 'CRN-01';
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-002' WHERE asset_code = 'CRN-02';
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-003' WHERE asset_code = 'CRN-03';
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-004' WHERE asset_code = 'CRN-04';
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-005' WHERE asset_code = 'CRN-05';
UPDATE document_incoming_scan SET asset_code = 'MCH-CRN-006' WHERE asset_code = 'CRN-06';

-- ─── OTHER MACHINES: MCH-xxx-xx → MCH-xxx-xxx ───
DELETE FROM asset_register WHERE asset_code IN ('MCH-01','MCH-02','MCH-03','MCH-04','MCH-05');
DELETE FROM asset_register WHERE asset_code IN ('MCH-DRL-01','MCH-GRN-01','MCH-PRB-01','MCH-GIL-01','MCH-SAW-01','MCH-SAW-02');

INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('MCH-DRL-001', 'Drill Line',        'machine', 'Fab Shop'),
  ('MCH-GRN-001', 'Pedestal Grinder',  'machine', 'Fab Shop'),
  ('MCH-PRB-001', 'Press Brake',       'machine', 'Fab Shop'),
  ('MCH-GIL-001', 'Guillotine',        'machine', 'Fab Shop'),
  ('MCH-SAW-001', 'Band Saw 1',        'machine', 'Fab Shop'),
  ('MCH-SAW-002', 'Band Saw 2',        'machine', 'Fab Shop')
ON CONFLICT (asset_code) DO NOTHING;

-- ─── FIRE EXTINGUISHERS (from inspection sheet) ───
DELETE FROM asset_register WHERE asset_code ~ '^FEX-';

INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  -- Fab Shop area
  ('FEX-FOA-001',  'Foam — Roller Shutter door (Victoria)',              'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-002',  'CO2 — Roller Shutter door (Victoria)',               'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-003',  'CO2 — Near Bohmar & exit',                           'fire-extinguisher', 'Fab Shop'),
  ('FEX-FOA-003A', 'Foam — Roller shutter door (south)',                  'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-003B', 'CO2 — Roller shutter door (south)',                   'fire-extinguisher', 'Fab Shop'),
  ('FEX-DPW-004',  'Powder — Near Bohmar south',                          'fire-extinguisher', 'Fab Shop'),
  ('FEX-FOA-005',  'Foam — Fire escape Bohmar conveyor',                  'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-006',  'CO2 — Fire escape Bohmar conveyor',                   'fire-extinguisher', 'Fab Shop'),
  ('FEX-DPW-007',  'Powder — Exit to office corridor',                    'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-008A', 'CO2 — Exit to offices corridor',                      'fire-extinguisher', 'Fab Shop'),
  ('FEX-DPW-008B', 'Powder — Exit to offices corridor',                   'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-009',  'CO2 — Workshop exit near foreman window',             'fire-extinguisher', 'Fab Shop'),
  ('FEX-FOA-010',  'Foam — Workshop exit near foreman window',            'fire-extinguisher', 'Fab Shop'),
  -- Basket Shop area
  ('FEX-CO2-011',  'CO2 — Entrance from fab shop',                        'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-012',  'Foam — Entrance from fab shop',                       'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-013',  'Foam — Into Fab Shop entrance',                       'fire-extinguisher', 'Basket Shop'),
  ('FEX-CO2-013A', 'CO2 — Small door exit into yard',                     'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-013B', 'Foam — Fab Shop roller shutter door',                 'fire-extinguisher', 'Basket Shop'),
  ('FEX-DPW-013C', 'Powder — Inside wall',                                'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-013D', 'Foam — Inside wall',                                  'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-014A', 'Foam — Roller shutter door (left)',                   'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-014B', 'Foam — Near fire escape & Big wood',                 'fire-extinguisher', 'Basket Shop'),
  ('FEX-DPW-015',  'Powder — Near fire escape & Big wood',               'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-017B', 'Foam — Near blocked door',                            'fire-extinguisher', 'Basket Shop'),
  ('FEX-CO2-017C', 'CO2 — Near blocked door',                             'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-017D', 'Foam — Near Ladder store',                            'fire-extinguisher', 'Basket Shop'),
  ('FEX-DPW-017E', 'Powder — Near Ladder store',                          'fire-extinguisher', 'Basket Shop'),
  ('FEX-CO2-019A', 'CO2 — Near big wood',                                 'fire-extinguisher', 'Basket Shop'),
  -- FICEP
  ('FEX-CO2-022',  'CO2 — FICEP',                                         'fire-extinguisher', 'FICEP'),
  -- Office / Corridor areas
  ('FEX-CO2-021A', 'CO2 — Upstairs corridor',                             'fire-extinguisher', 'Upstairs'),
  ('FEX-FOA-023',  'Foam — Kitchen',                                      'fire-extinguisher', 'Kitchen'),
  ('FEX-FOA-026',  'Foam — Overall corridor',                             'fire-extinguisher', 'Corridor'),
  ('FEX-WAT-027',  'Water — Employee entrance',                           'fire-extinguisher', 'Entrance'),
  ('FEX-CO2-028',  'CO2 — Foreman office entrance',                       'fire-extinguisher', 'Office'),
  ('FEX-CO2-029',  'CO2 — Upstairs office',                               'fire-extinguisher', 'Upstairs'),
  ('FEX-WAT-030',  'Water — Upstairs office',                             'fire-extinguisher', 'Upstairs'),
  ('FEX-WAT-030A', 'Water — Upstairs corridor',                           'fire-extinguisher', 'Upstairs'),
  ('FEX-CO2-031',  'CO2 — Downstairs corridor',                           'fire-extinguisher', 'Downstairs'),
  ('FEX-WAT-032',  'Water — Downstairs corridor',                         'fire-extinguisher', 'Downstairs'),
  ('FEX-CO2-034',  'CO2 — Boardroom',                                     'fire-extinguisher', 'Boardroom')
ON CONFLICT (asset_code) DO NOTHING;

-- ─── VEHICLES ───
INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('VEH-VAN-001', 'Van 1', 'vehicle', NULL),
  ('VEH-VAN-002', 'Van 2', 'vehicle', NULL),
  ('VEH-VAN-003', 'Van 3', 'vehicle', NULL),
  ('VEH-VAN-004', 'Van 4', 'vehicle', NULL),
  ('VEH-UTE-001', 'Pickup 1', 'vehicle', NULL),
  ('VEH-UTE-002', 'Pickup 2', 'vehicle', NULL),
  ('VEH-UTE-003', 'Pickup 3', 'vehicle', NULL),
  ('VEH-UTE-004', 'Pickup 4', 'vehicle', NULL)
ON CONFLICT (asset_code) DO NOTHING;

-- ─── FLTs → VEH-FLT ───
DELETE FROM asset_register WHERE asset_code IN ('FLT-CAT-01', 'FLT-HYSTER-01', 'FLT-HYS-01');

INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('VEH-FLT-001', 'CAT Forklift',    'vehicle', 'Yard'),
  ('VEH-FLT-002', 'Hyster Forklift', 'vehicle', 'Yard')
ON CONFLICT (asset_code) DO NOTHING;

UPDATE document_incoming_scan SET asset_code = 'VEH-FLT-001' WHERE asset_code IN ('FLT-CAT-01');
UPDATE document_incoming_scan SET asset_code = 'VEH-FLT-002' WHERE asset_code IN ('FLT-HYSTER-01', 'FLT-HYS-01');

-- ─── HSE site-level forms ───
INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('HS-CAR-001', 'Weekly Safety Inspection',       'hse-form', 'PSS'),
  ('HS-FEX-001', 'Fire Extinguisher Weekly Check',  'hse-form', 'PSS'),
  ('HS-HAV-001', 'HAVS Disc Usage Record',          'hse-form', 'PSS'),
  ('HS-CON-001', 'Contractor Induction',            'hse-form', 'PSS'),
  ('HS-AEI-001', 'Adverse Event Investigation',    'hse-form', 'PSS')
ON CONFLICT (asset_code) DO NOTHING;

-- Document definition for AEI
INSERT INTO document_definition (doc_code, doc_name, type_code, category, interval_days) VALUES
  ('AEI', 'Adverse Event Investigation', 'HS', NULL, NULL)
ON CONFLICT (doc_code) DO NOTHING;

-- Remove old SITE asset (replaced by HSE-xxx codes)
DELETE FROM asset_register WHERE asset_code = 'SITE';
