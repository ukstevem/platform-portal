-- Update assets with proper subtypes per ISO-aligned naming convention
-- Format: {CATEGORY}-{SUBTYPE}-{SEQ}

-- ─── CRANES: CRN-xx → CRN-OVH-xx ───
UPDATE document_incoming_scan SET asset_code = 'CRN-OVH-01' WHERE asset_code = 'CRN-01';
UPDATE document_incoming_scan SET asset_code = 'CRN-OVH-02' WHERE asset_code = 'CRN-02';
UPDATE document_incoming_scan SET asset_code = 'CRN-OVH-03' WHERE asset_code = 'CRN-03';
UPDATE document_incoming_scan SET asset_code = 'CRN-OVH-04' WHERE asset_code = 'CRN-04';
UPDATE document_incoming_scan SET asset_code = 'CRN-OVH-05' WHERE asset_code = 'CRN-05';
UPDATE document_incoming_scan SET asset_code = 'CRN-OVH-06' WHERE asset_code = 'CRN-06';

UPDATE asset_register SET asset_code = 'CRN-OVH-01' WHERE asset_code = 'CRN-01';
UPDATE asset_register SET asset_code = 'CRN-OVH-02' WHERE asset_code = 'CRN-02';
UPDATE asset_register SET asset_code = 'CRN-OVH-03' WHERE asset_code = 'CRN-03';
UPDATE asset_register SET asset_code = 'CRN-OVH-04' WHERE asset_code = 'CRN-04';
UPDATE asset_register SET asset_code = 'CRN-OVH-05' WHERE asset_code = 'CRN-05';
UPDATE asset_register SET asset_code = 'CRN-OVH-06' WHERE asset_code = 'CRN-06';

-- ─── MACHINES ───
DELETE FROM asset_register WHERE asset_code IN ('MCH-01','MCH-02','MCH-03','MCH-04','MCH-05');

INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  ('MCH-DRL-01', 'Drill Line',        'machine', 'Fab Shop'),
  ('MCH-GRN-01', 'Pedestal Grinder',  'machine', 'Fab Shop'),
  ('MCH-PRB-01', 'Press Brake',       'machine', 'Fab Shop'),
  ('MCH-GIL-01', 'Guillotine',        'machine', 'Fab Shop'),
  ('MCH-SAW-01', 'Band Saw 1',        'machine', 'Fab Shop'),
  ('MCH-SAW-02', 'Band Saw 2',        'machine', 'Fab Shop')
ON CONFLICT (asset_code) DO NOTHING;

-- ─── FIRE EXTINGUISHERS (from inspection sheet) ───
-- Delete old generic FEX-01 to FEX-34 entries
DELETE FROM asset_register WHERE asset_code ~ '^FEX-\d{2}$';

-- Insert properly typed entries: FEX-{TYPE}-{POSITION}
-- Types: FOA=Foam, CO2=CO2, DPW=Dry Powder, WAT=Water
INSERT INTO asset_register (asset_code, asset_name, category, location) VALUES
  -- Fab Shop area
  ('FEX-FOA-01',  'Foam — Roller Shutter door (Victoria)',              'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-02',  'CO2 — Roller Shutter door (Victoria)',               'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-03',  'CO2 — Near Bohmar & exit',                           'fire-extinguisher', 'Fab Shop'),
  ('FEX-FOA-03A', 'Foam — Roller shutter door (south)',                  'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-03B', 'CO2 — Roller shutter door (south)',                   'fire-extinguisher', 'Fab Shop'),
  ('FEX-DPW-04',  'Powder — Near Bohmar south',                          'fire-extinguisher', 'Fab Shop'),
  ('FEX-FOA-05',  'Foam — Fire escape Bohmar conveyor',                  'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-06',  'CO2 — Fire escape Bohmar conveyor',                   'fire-extinguisher', 'Fab Shop'),
  ('FEX-DPW-07',  'Powder — Exit to office corridor',                    'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-08A', 'CO2 — Exit to offices corridor',                      'fire-extinguisher', 'Fab Shop'),
  ('FEX-DPW-08B', 'Powder — Exit to offices corridor',                   'fire-extinguisher', 'Fab Shop'),
  ('FEX-CO2-09',  'CO2 — Workshop exit near foreman window',             'fire-extinguisher', 'Fab Shop'),
  ('FEX-FOA-10',  'Foam — Workshop exit near foreman window',            'fire-extinguisher', 'Fab Shop'),

  -- Basket Shop area
  ('FEX-CO2-11',  'CO2 — Entrance from fab shop',                        'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-12',  'Foam — Entrance from fab shop',                       'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-13',  'Foam — Into Fab Shop entrance',                       'fire-extinguisher', 'Basket Shop'),
  ('FEX-CO2-13A', 'CO2 — Small door exit into yard',                     'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-13B', 'Foam — Fab Shop roller shutter door',                 'fire-extinguisher', 'Basket Shop'),
  ('FEX-DPW-13C', 'Powder — Inside wall',                                'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-13D', 'Foam — Inside wall',                                  'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-14A', 'Foam — Roller shutter door (left)',                   'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-14B', 'Foam — Near fire escape & Big wood',                 'fire-extinguisher', 'Basket Shop'),
  ('FEX-DPW-15',  'Powder — Near fire escape & Big wood',               'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-17B', 'Foam — Near blocked door',                            'fire-extinguisher', 'Basket Shop'),
  ('FEX-CO2-17C', 'CO2 — Near blocked door',                             'fire-extinguisher', 'Basket Shop'),
  ('FEX-FOA-17D', 'Foam — Near Ladder store',                            'fire-extinguisher', 'Basket Shop'),
  ('FEX-DPW-17E', 'Powder — Near Ladder store',                          'fire-extinguisher', 'Basket Shop'),
  ('FEX-CO2-19A', 'CO2 — Near big wood',                                 'fire-extinguisher', 'Basket Shop'),

  -- FICEP
  ('FEX-CO2-22',  'CO2 — FICEP',                                         'fire-extinguisher', 'FICEP'),

  -- Office / Corridor areas
  ('FEX-CO2-21A', 'CO2 — Upstairs corridor',                             'fire-extinguisher', 'Upstairs'),
  ('FEX-FOA-23',  'Foam — Kitchen',                                      'fire-extinguisher', 'Kitchen'),
  ('FEX-FOA-26',  'Foam — Overall corridor',                             'fire-extinguisher', 'Corridor'),
  ('FEX-WAT-27',  'Water — Employee entrance',                           'fire-extinguisher', 'Entrance'),
  ('FEX-CO2-28',  'CO2 — Foreman office entrance',                       'fire-extinguisher', 'Office'),
  ('FEX-CO2-29',  'CO2 — Upstairs office',                               'fire-extinguisher', 'Upstairs'),
  ('FEX-WAT-30',  'Water — Upstairs office',                             'fire-extinguisher', 'Upstairs'),
  ('FEX-WAT-30A', 'Water — Upstairs corridor',                           'fire-extinguisher', 'Upstairs'),
  ('FEX-CO2-31',  'CO2 — Downstairs corridor',                           'fire-extinguisher', 'Downstairs'),
  ('FEX-WAT-32',  'Water — Downstairs corridor',                         'fire-extinguisher', 'Downstairs'),
  ('FEX-CO2-34',  'CO2 — Boardroom',                                     'fire-extinguisher', 'Boardroom')
ON CONFLICT (asset_code) DO NOTHING;

-- ─── FLTs: add subtype ───
UPDATE document_incoming_scan SET asset_code = 'FLT-CAT-01' WHERE asset_code = 'FLT-CAT-01';
UPDATE document_incoming_scan SET asset_code = 'FLT-HYS-01' WHERE asset_code = 'FLT-HYSTER-01';
UPDATE asset_register SET asset_code = 'FLT-HYS-01', asset_name = 'Hyster Forklift 1' WHERE asset_code = 'FLT-HYSTER-01';
