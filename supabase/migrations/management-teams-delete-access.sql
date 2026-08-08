-- ============================================================
-- Widen teams_delete to also allow 'management' role, so
-- management can delete teams from the Team Leaders Management
-- page. Deleting a team cascades to remove its team_members,
-- team_leaders, and team_rotations rows (existing FK behavior,
-- unchanged by this migration); requests.team_id is set to NULL
-- rather than deleted, preserving historical leave/overtime
-- requests.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — the policy is dropped and
-- recreated with an added role check; no data or table changes.
-- ============================================================

DROP POLICY IF EXISTS "teams_delete" ON teams;
CREATE POLICY "teams_delete" ON teams FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));
