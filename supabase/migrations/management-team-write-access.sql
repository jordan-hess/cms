-- ============================================================
-- Widen admin-only write policies to also allow 'management'
-- role, for the new Team Leaders Management page.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — policies are dropped and
-- recreated with an added role check; no data or table changes.
-- ============================================================

-- ─── profiles ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;
CREATE POLICY "Admins can update any profile" ON profiles FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
);

DROP POLICY IF EXISTS "Admins can insert profiles" ON profiles;
CREATE POLICY "Admins can insert profiles" ON profiles FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
);

-- ─── team_members ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "team_members_insert" ON team_members;
CREATE POLICY "team_members_insert" ON team_members FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));

DROP POLICY IF EXISTS "team_members_update" ON team_members;
CREATE POLICY "team_members_update" ON team_members FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));

DROP POLICY IF EXISTS "team_members_delete" ON team_members;
CREATE POLICY "team_members_delete" ON team_members FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));

-- ─── team_leaders ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "team_leaders_insert" ON team_leaders;
CREATE POLICY "team_leaders_insert" ON team_leaders FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));

DROP POLICY IF EXISTS "team_leaders_update" ON team_leaders;
CREATE POLICY "team_leaders_update" ON team_leaders FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));

DROP POLICY IF EXISTS "team_leaders_delete" ON team_leaders;
CREATE POLICY "team_leaders_delete" ON team_leaders FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));
