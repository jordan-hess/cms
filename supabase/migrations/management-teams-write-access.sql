-- ============================================================
-- Widen teams_insert/teams_update to also allow 'management'
-- role, so management can create teams and rename them from the
-- Team Leaders Management page. teams_delete stays admin-only —
-- deleting a team isn't part of this feature.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — policies are dropped and
-- recreated with an added role check; no data or table changes.
-- ============================================================

DROP POLICY IF EXISTS "teams_insert" ON teams;
CREATE POLICY "teams_insert" ON teams FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));

DROP POLICY IF EXISTS "teams_update" ON teams;
CREATE POLICY "teams_update" ON teams FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));
