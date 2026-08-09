-- ============================================================
-- NOTE: this migration turned out to be an unnecessary no-op.
--
-- During QA of the management-followups feature, a live RLS test
-- appeared to show notifications INSERT was broken for anyone
-- notifying someone other than themselves. The real cause was the
-- test's own use of `Prefer: return=representation` on the insert,
-- which triggers a read-back of the inserted row gated by the
-- SELECT policy (`recipient_id = auth.uid()`), not the INSERT
-- policy — unrelated to whether the insert itself was allowed.
-- Retesting with `Prefer: return=minimal` (matching how the real
-- app calls `.insert()`, which never chains `.select()`) succeeded
-- immediately. The live INSERT policy was never actually broken.
--
-- This file is a harmless, byte-identical re-assertion of the
-- policy already defined in supabase/schema.sql. Kept for the
-- record rather than deleted, so the false alarm and its
-- self-correction aren't silently erased from history.
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON notifications;
CREATE POLICY "Authenticated users can insert notifications" ON notifications FOR INSERT TO authenticated WITH CHECK (TRUE);
