-- Document definitions: controlled list of specific document types within each ISO 19650 category

create table if not exists document_definition (
  id              serial primary key,
  doc_code        text        not null unique,   -- short code used in QR (e.g. 'WEEKLY-PREUSE')
  doc_name        text        not null,          -- human-readable name
  type_code       text        not null references document_filing_rule(type_code),
  category        text,                          -- asset category this applies to (null = any)
  interval_days   int,                           -- inspection/review interval (null = one-off)
  notes           text,
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_document_definition_type on document_definition (type_code);
create index idx_document_definition_category on document_definition (category);

-- Seed: crane inspection documents
insert into document_definition (doc_code, doc_name, type_code, category, interval_days) values
  ('WEEKLY-PREUSE',  'Weekly Pre-Use Inspection',     'HS',   'crane', 7),
  ('LOLER-ANNUAL',   'LOLER Thorough Examination',    'HS',   'crane', 365),
  ('6M-THOROUGH',    '6-Monthly Thorough Examination','HS',   'crane', 182),
  ('BRAKE-TEST',     'Brake Test Certificate',        'X-IC', 'crane', 365),
  ('LOAD-TEST',      'Load Test Certificate',         'X-IC', 'crane', 365)
on conflict (doc_code) do nothing;

-- Add doc_code column to document_incoming_scan
alter table document_incoming_scan
  add column if not exists doc_code text references document_definition(doc_code);

-- RLS
alter table document_definition enable row level security;

create policy "Authenticated users can read document definitions"
  on document_definition for select
  to authenticated using (true);

create policy "Authenticated users can manage document definitions"
  on document_definition for all
  to authenticated using (true) with check (true);
