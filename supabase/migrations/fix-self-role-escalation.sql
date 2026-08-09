-- ============================================================
-- Close a privilege-escalation gap: the "Users can update own
-- profile" policy had no WITH CHECK, so any authenticated user
-- could self-promote to admin (or any role) via a direct Supabase
-- call, bypassing the UI's existing self-role-edit guard.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — both policies below are
-- dropped and recreated with an added WITH CHECK; no data or
-- table changes. Both DROP+CREATE blocks are idempotent — safe
-- to re-run this whole file even if the first block already ran.
-- Scope is role-only: every other self-editable field (full_name,
-- department, password_hash, etc.) remains unrestricted.
-- ============================================================

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
  );

-- Second policy needed too: "Admins can update any profile" was widened in
-- an earlier feature to let 'admin' OR 'management' update ANY profile, with
-- no WITH CHECK at all. Since Postgres OR's multiple applicable UPDATE
-- policies together, a 'management' user updating THEIR OWN row satisfied
-- this second, broader policy regardless of the fix above — completely
-- bypassing it. Confirmed live: a management-role test update of role to
-- 'admin' on its own row succeeded before this block was added, and was
-- manually reverted immediately after being caught.
--
-- The fix must NOT block 'management' promoting OTHER people to admin
-- (this is existing, legitimate behavior — e.g. assigning someone as a team
-- leader auto-promotes them to admin from the Team Management board) — only
-- self-targeting is blocked, and only for the actor's own role. 'admin'
-- actors are unrestricted here (self-role-changes by an existing admin
-- aren't a privilege escalation).
DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;
CREATE POLICY "Admins can update any profile" ON profiles FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
    AND (
      auth.uid() != id
      OR role = (SELECT role FROM profiles WHERE id = auth.uid())
    )
  );
