-- ============================================================
-- Widen the notifications SELECT policy so 'management' can read
-- any recipient's notifications — needed for the management
-- dashboard's per-team-leader "Unread Alerts" stat. This table
-- previously had NO role-based bypass at all (unlike
-- customers/callbacks/followups).
--
-- Deliberately does NOT include 'admin' here, unlike every other
-- management-*-access.sql migration in this project. Every team
-- leader is an admin-role profile (enforce_team_leader_is_admin
-- trigger, team-leaders-schema.sql), and the warnings feature
-- deliberately restricts a team leader's visibility of warnings
-- to only their own team's agents (warnings_select in
-- warnings-schema.sql) — never their own warnings, never other
-- team leaders', never management's. Since WarningModal.tsx also
-- writes a notifications row carrying the warning's full reason
-- text (message: reason) alongside every warning, granting admin
-- blanket notifications SELECT would let any team leader bypass
-- warnings_select's per-team scoping entirely by reading
-- notifications directly instead. management already has
-- blanket warnings visibility via warnings_select, so widening
-- notifications for management introduces no new leak there —
-- only the admin branch would have.
--
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — RLS policy is dropped/recreated,
-- no data changes.
-- ============================================================

DROP POLICY IF EXISTS "Users see own notifications" ON notifications;
CREATE POLICY "Users see own notifications" ON notifications FOR SELECT TO authenticated USING (
  recipient_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
);
