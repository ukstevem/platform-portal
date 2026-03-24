-- QR document scanner: ISO 19650 filing rules + incoming scan tracking

-- Filing rules based on ISO 19650 document type codes
-- Also includes ISO 15489 retention metadata for records management compliance
create table if not exists document_filing_rule (
  id                serial primary key,
  type_code         text        not null unique,   -- ISO 19650 type code (encoded in QR)
  document_type     text        not null,          -- human-readable type name
  destination       text        not null,          -- relative folder path for filing
  description       text,
  retention_years   int,                           -- ISO 15489: retention period (null = permanent)
  disposal_action   text        default 'review'   -- ISO 15489: 'destroy', 'archive', 'review'
                    check (disposal_action in ('destroy','archive','review')),
  active            boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Seed ISO 19650 document type codes relevant to PSS engineering/fabrication
insert into document_filing_rule (type_code, document_type, destination, description, retention_years, disposal_action) values
  -- Core engineering types (ISO 19650 type codes)
  ('DR',  'Drawing',                  'DR-drawings',          '2D drawings — fabrication, GA, detail',                   25, 'archive'),
  ('M3',  '3D Model',                 'M3-models',            '3D model files — BIM, CAD assemblies',                    25, 'archive'),
  ('SN',  'Specification',            'SN-specifications',    'Technical specifications and standards',                   10, 'review'),
  ('RP',  'Report',                   'RP-reports',           'Inspection, test, and engineering reports',                10, 'review'),
  ('SH',  'Schedule',                 'SH-schedules',         'Schedules — materials, equipment, deliveries',              7, 'destroy'),
  ('CR',  'Correspondence',           'CR-correspondence',    'Letters, RFIs, transmittals, emails',                       7, 'destroy'),
  ('MR',  'Minutes / Meeting Record', 'MR-minutes',           'Meeting minutes and records',                               7, 'destroy'),
  ('MS',  'Method Statement',         'MS-method-statements', 'Method statements and work procedures',                   10, 'archive'),
  ('HS',  'Health & Safety',          'HS-health-safety',     'Health & safety documents, risk assessments, RAMS',        40, 'archive'),
  ('PR',  'Programme',                'PR-programmes',        'Project programmes and Gantt charts',                       7, 'review'),
  ('PP',  'Presentation',             'PP-presentations',     'Presentations and briefing packs',                          3, 'destroy'),
  ('VS',  'Visualisation',            'VS-visualisations',    'Renders, visualisations, and animations',                   3, 'destroy'),
  ('SU',  'Survey',                   'SU-surveys',           'Site surveys, measured surveys, condition reports',         10, 'archive'),
  ('SK',  'Sketch',                   'SK-sketches',          'Sketches, mark-ups, and preliminary designs',                3, 'review'),
  ('IE',  'Information Exchange',     'IE-exchanges',         'Information exchange deliverables (COBie, data drops)',     10, 'archive'),
  ('DB',  'Database / Register',      'DB-registers',         'Databases, registers, and logs',                            7, 'review'),

  -- PSS-specific extensions (prefixed to avoid future ISO conflicts)
  ('X-IC', 'Inspection Certificate',  'X-IC-inspection-certs',  'Inspection and test certificates',                       25, 'archive'),
  ('X-DN', 'Delivery Note',           'X-DN-delivery-notes',    'Goods-in delivery notes',                                 7, 'destroy'),
  ('X-WM', 'Weld Map',               'X-WM-weld-maps',         'Welding procedure and weld maps',                        25, 'archive'),
  ('X-MC', 'Material Certificate',    'X-MC-material-certs',    'Material test certificates (EN 10204)',                   25, 'archive'),
  ('X-PT', 'Pressure Test Report',    'X-PT-pressure-tests',    'Pressure, hydro, and leak test reports',                  25, 'archive'),
  ('X-WP', 'Welding Procedure (WPS)', 'X-WP-weld-procedures',  'Welding procedure specifications and PQRs',              25, 'archive'),
  ('X-NC', 'Non-Conformance Report',  'X-NC-ncr',              'Non-conformance and corrective action reports',           10, 'archive'),
  ('X-PO', 'Purchase Order',          'X-PO-purchase-orders',   'Purchase orders and procurement docs',                    7, 'destroy')
on conflict (type_code) do nothing;

-- Incoming scan tracking
create table if not exists document_incoming_scan (
  id              uuid        primary key default gen_random_uuid(),
  file_name       text        not null,
  file_path       text        not null,       -- path in scanner inbox
  status          text        not null default 'queued'
                  check (status in ('queued','scanning','filed','error')),
  type_code       text,                       -- ISO 19650 code decoded from QR
  document_type   text,                       -- resolved human-readable type
  destination     text,                       -- folder the file was filed to
  filed_path      text,                       -- final path after filing
  error_message   text,
  uploaded_by     uuid        references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Index for worker polling
create index idx_document_incoming_scan_status on document_incoming_scan (status) where status = 'queued';

-- RLS
alter table document_filing_rule enable row level security;
alter table document_incoming_scan enable row level security;

create policy "Authenticated users can read filing rules"
  on document_filing_rule for select
  to authenticated using (true);

create policy "Authenticated users can manage filing rules"
  on document_filing_rule for all
  to authenticated using (true) with check (true);

create policy "Authenticated users can read incoming scans"
  on document_incoming_scan for select
  to authenticated using (true);

create policy "Authenticated users can insert incoming scans"
  on document_incoming_scan for insert
  to authenticated with check (true);

create policy "Authenticated users can update incoming scans"
  on document_incoming_scan for update
  to authenticated using (true) with check (true);

-- Service role (scanner-worker) bypasses RLS — no policy needed
