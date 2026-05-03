-- Re-key document_app_filing_rule from (app_code, iso_tech_area_id, iso_description_id)
-- down to (app_code, iso_description_id), with iso_tech_area becoming a default
-- on the row that calling apps can override per-upload.
--
-- Rationale: the original 032 PK forced one row per tech_area variant of the
-- same doc type. With this rule shape, one row per (app, doc type) suffices,
-- and tech_area is selected at upload time (defaulting to the rule's value).
--
-- Matches the Q7-C decision in the design grill: "Per-(app + subclass) default
-- in app_filing_rule, with per-upload override".
--
-- Safe in-place rename: document_app_filing_rule has no rows yet on either
-- environment.

alter table document_app_filing_rule drop constraint document_app_filing_rule_pkey;

alter table document_app_filing_rule
  rename column iso_tech_area_id to default_iso_tech_area_id;

alter table document_app_filing_rule add primary key (app_code, iso_description_id);
