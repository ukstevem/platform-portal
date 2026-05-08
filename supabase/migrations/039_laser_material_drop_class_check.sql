-- Drop the hardcoded material_class CHECK constraints so operators can add
-- new classes (brass, copper, titanium, etc.) from the LaserQuote Settings
-- UI without a schema migration each time.
--
-- Normalisation (trim+upper) happens at the app layer on insert/update.
-- The pricing engine (pss-document-service/src/laser/pricing.ts) already
-- normalises both sides of grade comparisons (see bead 9r2), and falls back
-- to laser_material.density / laser_material.rate per row when set, so new
-- classes price correctly as long as the row carries a rate (and density
-- if it differs from mild's default of 7.85 g/cm³).

alter table laser_material
  drop constraint if exists laser_material_material_class_check;

alter table laser_import
  drop constraint if exists laser_import_material_check;
