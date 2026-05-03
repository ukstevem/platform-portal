-- Per-app, per-(tech_area, description) filing logic for the doc service.
-- Each row tells the doc service: "when app X uploads a document classified as
-- ISO 61355 (tech_area, description), put it here, name it like this, require
-- this metadata, and dedup against these keys."
--
-- Templates support {placeholders}: {tech_area}, {subclass}, {description},
-- {period}, {subject_code}, plus any meta.* keys (e.g. {meta.po_number}).
--
-- Explicit-only rules — no wildcards, no defaults. Missing rule = NO_FILING_RULE
-- error returned to the calling app.
--
-- Tracked in pss-document-service-all.

create table if not exists document_app_filing_rule (
  app_code            text        not null references document_app(app_code) on delete cascade,
  iso_tech_area_id    int         not null references iso61355_technical_area(id),
  iso_description_id  int         not null references iso61355_description(id),

  -- jsonb array of meta keys that MUST be present on the upload, e.g.
  --   ["project_id", "po_number"]
  -- Missing key → 400 META_REQUIRED.
  required_meta       jsonb       not null default '[]'::jsonb,

  -- Filing path template, e.g.
  --   'documents/orderbook/customers/{subject_code}/po/'
  path_template       text        not null,

  -- Canonical filename template, e.g.
  --   '{subject_code}_{tech_area}&{subclass}_{meta.po_number}_{period}'
  -- Doc service appends the original extension; collisions get _002/_003 suffix.
  filename_template   text        not null,

  -- jsonb array of independent dedup checks. Each entry has shape
  --   { "name": "duplicate_project", "keys": ["app_code", "meta.project_id", "iso_description_id"] }
  -- Hash dedup (DUPLICATE_EXACT) always runs first regardless. Logical dedup
  -- runs each entry independently; any match → DUPLICATE_LOGICAL with the
  -- matched_rule name and the prior doc's info in the response. force=true
  -- on the upload skips logical dedup only (never hash).
  dedup_rules         jsonb       not null default '[]'::jsonb,

  active              boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  primary key (app_code, iso_tech_area_id, iso_description_id)
);

-- Lookup-by-active fast-path for the upload endpoint's rule resolution.
create index if not exists idx_document_app_filing_rule_active
  on document_app_filing_rule (app_code) where active = true;

-- RLS: service-role only — admin manages via doc service endpoints, not direct.
alter table document_app_filing_rule enable row level security;
