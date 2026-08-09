-- ============================================================
-- Close a privilege-escalation gap: the "Users can update own
-- profile" policy had no WITH CHECK, so any authenticated user
-- could self-promote to admin (or any role) via a direct Supabase
-- call, bypassing the UI's existing self-role-edit guard.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — the policy is dropped and
-- recreated with an added WITH CHECK; no data or table changes.
-- Scope is role-only: every other self-editable field (full_name,
-- department, password_hash, etc.) remains unrestricted. Admins
-- updating OTHER users' roles via "Admins can update any profile"
-- are unaffected — that policy is untouched.
-- ============================================================

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
  );
