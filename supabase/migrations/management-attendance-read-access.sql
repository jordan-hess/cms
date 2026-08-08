-- ============================================================
-- Widen read-only RLS policies so 'management' can view today's
-- attendance data, for the new Management console attendance
-- summary.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — policies are dropped and
-- recreated with an added role check; no data or table changes.
-- No INSERT/UPDATE/DELETE policies are touched — this is
-- read-only widening.
-- ============================================================

DROP POLICY IF EXISTS "attendance_select" ON attendance_records;
CREATE POLICY "attendance_select" ON attendance_records FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));

DROP POLICY IF EXISTS "roster_overrides_select" ON roster_overrides;
CREATE POLICY "roster_overrides_select" ON roster_overrides FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));
