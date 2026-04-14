-- Add induction expiry date to supplier_employee
ALTER TABLE supplier_employee
  ADD COLUMN IF NOT EXISTS induction_expiry date;

-- Backfill: set expiry to 12 months from induction_date for existing records
UPDATE supplier_employee
  SET induction_expiry = induction_date + INTERVAL '12 months'
  WHERE induction_date IS NOT NULL AND induction_expiry IS NULL;
