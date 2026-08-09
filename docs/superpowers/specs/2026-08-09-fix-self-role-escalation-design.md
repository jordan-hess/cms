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

**Amendment, found during live verification of the fix above:** an `agent` session's self-promotion attempt was correctly rejected, but a `management` session's identical attempt *succeeded*. `"Admins can update any profile"` (`supabase/schema.sql:132-134`) was widened in an earlier feature to `role IN ('admin', 'management')` with no `WITH CHECK` at all — since Postgres OR's multiple applicable UPDATE policies together, a `management` actor updating their own row satisfies that second, broader policy regardless of the fix above, bypassing it entirely. This second policy's broad access is legitimate and needed elsewhere (management promoting *other* people to admin, e.g. when assigning a team leader) — only self-targeting needed to close:

```sql
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
```

`admin` actors remain fully unrestricted (self-role-changes by an existing admin aren't a privilege escalation); `management` actors keep full ability to change *other* people's roles, only self-targeting is blocked.

## What's unaffected

- Every other self-editable field (`full_name`, `department`, `password_hash`, etc.) — unrestricted, only `role` is guarded.
- `management` promoting *other* people to `admin` (e.g. the team-leader-assignment auto-promote flow) — unaffected, only self-targeting is blocked on the second policy.
- No application code changes — the UI never attempts a self-role-change, so nothing needs updating there. This is purely closing a gap between what the UI allows and what the database actually enforces.

## Verification approach

- Mint a low-privilege (`agent`) session; attempt `profiles.update({ role: 'admin' }).eq('id', self)` directly via REST — must be rejected by RLS.
- Mint a `management` session; attempt the same self-promotion — must ALSO be rejected (this is the case the first version of this fix missed).
- Confirm a `management`/`agent` session's self-update of an unrelated field (e.g. `department`) still succeeds.
- Confirm an `admin` session can still update another user's `role` via the existing admin policy, unaffected by this change.
- Any test that mutates a real account's role must be reverted immediately after observing the result, verified via a service-role read.
