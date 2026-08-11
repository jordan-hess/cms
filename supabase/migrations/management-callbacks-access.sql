-- ============================================================
-- Widen the callbacks SELECT policy so 'management' can read
-- every agent's callbacks — needed for the management dashboard's
-- per-team-leader "Pending Callbacks" stat. Mirrors the exact
-- pattern already used for followups
-- (management-followups-access.sql).
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — RLS policy is dropped/recreated,
-- no data changes.
-- ============================================================

DROP POLICY IF EXISTS "Agents see their own callbacks" ON callbacks;
CREATE POLICY "Agents see their own callbacks" ON callbacks FOR SELECT TO authenticated USING (
  agent_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
);
