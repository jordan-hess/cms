-- ============================================================
-- Restore the notifications INSERT policy to match what's
-- checked into supabase/schema.sql (WITH CHECK (TRUE)).
--
-- Found during QA of the management-followups feature: the LIVE
-- policy no longer matched the checked-in schema — it silently
-- rejected any notification insert where the recipient wasn't
-- the inserting user themselves (confirmed live: agent
-- self-notify succeeded, but agent/admin/management notifying
-- someone ELSE all failed with 42501). This has been silently
-- breaking the "notify the assignee" step in the existing
-- Escalations feature (whose insert error was never checked) and
-- would have done the same to this new feature's assign/reassign
-- notifications.
--
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — the policy is dropped and
-- recreated; no data or table changes.
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON notifications;
CREATE POLICY "Authenticated users can insert notifications" ON notifications FOR INSERT TO authenticated WITH CHECK (TRUE);
