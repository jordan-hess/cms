-- ============================================================
-- Widen the notifications SELECT policy so 'admin' and
-- 'management' can read any recipient's notifications — needed
-- for the management dashboard's per-team-leader "Unread Alerts"
-- stat. This table previously had NO role-based bypass at all
-- (unlike customers/callbacks/followups), so this is a genuinely
-- new capability for both roles, not just management — matching
-- the "admin sees everything" convention already established for
-- every other table's management-*-access.sql migration in this
-- project.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — RLS policy is dropped/recreated,
-- no data changes.
-- ============================================================

DROP POLICY IF EXISTS "Users see own notifications" ON notifications;
CREATE POLICY "Users see own notifications" ON notifications FOR SELECT TO authenticated USING (
  recipient_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
);
