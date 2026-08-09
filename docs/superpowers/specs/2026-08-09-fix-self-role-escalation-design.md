# Fix Self-Role-Escalation RLS Gap — Design

## Context

The final review of the admin-agents-board-redesign plan surfaced a pre-existing gap: `profiles`' `"Users can update own profile"` RLS policy (`supabase/schema.sql:131`) is `USING (auth.uid() = id)` with no `WITH CHECK` clause. Postgres defaults an UPDATE policy's `WITH CHECK` to its `USING` expression when none is given, which only constrains *which row* can be touched, not *what values* it can be changed to. Any authenticated user can therefore call `supabase.from('profiles').update({ role: 'admin' }).eq('id', <self>)` directly (bypassing the UI entirely, which already disables the Role field for self-edits via `EditPersonModal`) and succeed.

## Fix

Widen the policy with an explicit `WITH CHECK` that rejects any self-update changing `role`:

```sql
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
  );
```

This mirrors the UI's existing rule (you can't change your own role) at the database layer, making it a real security boundary rather than a guardrail a browser console can walk around. Scope is role-only, per an explicit decision during design — self-deactivation isn't a privilege escalation (it can only reduce the actor's own access) and is out of scope for this fix.

## What's unaffected

- Every other self-editable field (`full_name`, `department`, `password_hash`, etc.) — unrestricted, only `role` is guarded.
- `"Admins can update any profile"` (`supabase/schema.sql:132-134`) — untouched. An admin can still change anyone's role, including their own, via that separate policy (its `USING` clause requires the *actor* to already be `role = 'admin'`, so this was never an escalation vector for a lower-privileged user in the first place).
- No application code changes — the UI never attempts a self-role-change, so nothing needs updating there. This is purely closing a gap between what the UI allows and what the database actually enforces.

## Verification approach

- Mint a low-privilege (`agent`) session; attempt `profiles.update({ role: 'admin' }).eq('id', self)` directly via REST — must be rejected by RLS.
- Confirm the same session's self-update of an unrelated field (e.g. `department`) still succeeds.
- Confirm an `admin` session can still update another user's `role` via the existing admin policy, unaffected by this change.
- Confirm a `management` session likewise cannot self-promote to `admin`.
