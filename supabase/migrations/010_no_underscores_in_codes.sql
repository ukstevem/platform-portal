-- Prevent underscores in codes — underscore is the field separator in ISO 19650 filenames
-- Filename format: {identifier}_{type_code}_{doc_code}_{period}_{revision}.ext

alter table document_filing_rule
  add constraint chk_type_code_no_underscore check (type_code !~ '_');

alter table asset_register
  add constraint chk_asset_code_no_underscore check (asset_code !~ '_');

alter table document_definition
  add constraint chk_doc_code_no_underscore check (doc_code !~ '_');
