-- The device_status table is populated by the heartbeat/status subscriber
-- service (service_role) but is read by the laser dashboard from the browser
-- under the authenticated role. The existing service_role_only policy
-- prevented those reads, so the dashboard always rendered 'Offline'.
-- Allow any logged-in user to SELECT device statuses.

create policy "Authenticated users can read device statuses"
  on device_status for select to authenticated using (true);
