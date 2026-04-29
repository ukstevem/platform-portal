-- ============================================================
-- Timesheet variance snapshot columns
-- ============================================================
-- Cross-check between allocated project hours (timesheet_entries)
-- and clocked hours (presence: employees_daily_hours RPC).
-- Variance is computed and snapshotted at the moment of approval;
-- foreman re-approves to refresh after upstream clocking corrections.
--
-- All four columns are NULL on legacy approval rows. New approvals
-- populate all four atomically. The deviations report filters out
-- rows where variance_minutes IS NULL.

ALTER TABLE timesheet_approvals
  ADD COLUMN IF NOT EXISTS clocked_minutes        integer,
  ADD COLUMN IF NOT EXISTS allocated_work_minutes integer,
  ADD COLUMN IF NOT EXISTS variance_minutes       integer,
  ADD COLUMN IF NOT EXISTS incomplete_clocking    boolean;

-- variance_minutes is signed: clocked_minutes - allocated_work_minutes.
-- Positive => under-allocated (clocked more than assigned to projects).
-- Negative => over-allocated (more assigned than clocked).
-- allocated_work_minutes excludes SICK-01, HOLIDAY-01, TRAINING-01.
-- incomplete_clocking is true if any day in the week had a missed
-- clock-in or clock-out at the moment of approval.
