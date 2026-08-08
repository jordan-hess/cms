# Team Leaders Management page — Design

## Context

This is the second of two role-customization requests for the `management` role (the first, already shipped, replaced the "Customers" page with a "Coaching" page — see `docs/superpowers/specs/` history and `app/(app)/coaching/`). This one replaces the "Callbacks" nav link/page for `management`-role users only with a new "Team Leaders Management" page: a drag-and-drop board where managers can see every team's members and leader, move people between teams, promote an agent to team leader by dropping them into a leader slot, add unassigned people to a team, edit a person's profile fields, and deactivate someone.

Agents and admins keep Callbacks exactly as-is — the `callbacks` table and route are untouched (it's a shared dependency of the agent and admin dashboards).

Several rounds of clarification with the owner resolved what would otherwise be dangerous ambiguity:

- **Access model**: today `management` has zero write access to `profiles`, `team_members`, or `team_leaders` — every write policy on those tables is `role = 'admin'`-only, and `app/api/admin/create-user/route.ts` explicitly 403s non-admins. Confirmed approach: widen the existing RLS policies to also accept `management`, matching how `admin` already behaves as a superuser across the rest of this schema, rather than building a parallel set of API routes.
- **"Delete" doesn't delete.** A literal permanent delete was requested first, but `profiles.id` has foreign keys from `customers`, `callbacks`, `followups`, `attendance_records`, `team_rotations`, `team_leaders.assigned_by`, `request_approval_history`, `notifications.sender_id`, and `password_reset_requests.reviewed_by` — almost none of them `ON DELETE CASCADE`/`SET NULL`. A real delete would fail outright for anyone with activity history and silently cascade-lose data for anyone without it. Confirmed resolution: the button deactivates (`is_active = false`), identical to the existing admin "Manage Agents" page's toggle — just relabeled honestly ("Deactivate," not "Delete") since it isn't destructive.
- **Naming collision, accepted deliberately.** There's already a decorative "Teamleaders" window on the admin/management dashboard console (unrelated — just shows generic stats). The owner chose to keep "Team Leaders Management" as this page's name anyway, despite the overlap.
- **Drag semantics**: dropping a card in a different team's section always *moves* the person (leave old, join new) — for both regular agents and team leaders, never accumulates a second assignment.
- **Auto-promotion**: dropping a plain agent into a leader slot promotes them to `admin` and assigns them as that team's leader, in one action — consistent with the existing DB trigger (`enforce_team_leader_is_admin()`) that already requires leaders to be admins.
- **"Add"** assigns an *existing* person who currently has no team, not a "create new account" flow.
- **"Edit"** changes full name, department, and role (a three-way `agent`/`admin`/`management` choice — wider than the existing admin page's two-way admin⇄agent toggle, since `management` becomes a peer of `admin` for these tables under the new access model).

## Access model — RLS migration

New file `supabase/migrations/management-team-write-access.sql`. Verified the exact current policy names and clauses directly against the live schema files before writing this (not guessed):

```sql
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
```

`DROP POLICY` + `CREATE POLICY` (not `ALTER POLICY`) matches this repo's own existing convention (`team-leaders-schema.sql` uses the same shape). The `enforce_team_leader_is_admin()` trigger is untouched — it still requires the target profile to be `role = 'admin'`; the UI satisfies that by promoting first (see Mutations below), not by changing the trigger.

## Drag-and-drop library

No DnD library exists in this codebase today (confirmed: no `@dnd-kit`, `react-beautiful-dnd`, `react-dnd`, no native `draggable` usage anywhere). Adding:
- `@dnd-kit/core` — actively maintained, accessible (pointer + keyboard sensors, not raw HTML5 DnD), smallest API surface for a one-drag/one-drop-target interaction. `react-beautiful-dnd` is archived/unmaintained; `react-dnd` needs more boilerplate for this simple a case.
- `@dnd-kit/utilities` — small companion package for the `CSS.Transform.toString()` helper used to position a dragged card.

`@dnd-kit/sortable` is not needed — there's no requirement to reorder people within a team, only to move them between teams.

Structure: a single `DndContext` wraps the whole board. Each team column registers two separate droppables — one for its leader slot (`leader:${teamId}`), one for its member list (`members:${teamId}`) — so `onDragEnd` can tell which kind of drop happened from `over.id`. Each person card is a draggable carrying its current team/slot/role in `data`. A `DragOverlay` renders the floating card preview during drag.

## Query design

`app/(app)/team-leaders/page.tsx`, four parallel flat fetches (this codebase's established convention — no RPCs, no views, no ORM):

```ts
supabase.from('teams').select('id, name, color, description').order('name'),
supabase.from('team_members').select('id, team_id, profile_id, joined_at, profiles(id, full_name, email, role, department, is_active)'),
supabase.from('team_leaders').select('id, team_id, profile_id, assigned_by, created_at, profiles!team_leaders_profile_id_fkey(id, full_name, email, role, department, is_active)'),
supabase.from('profiles').select('id, full_name, email, role, department, is_active').eq('is_active', true),
```

The `team_leaders` embed MUST be qualified as `profiles!team_leaders_profile_id_fkey(...)` — `team_leaders` has two foreign keys to `profiles` (`profile_id`, `assigned_by`), and an unqualified embed returns a PostgREST error instead of rows. (This exact bug was hit and fixed while building the Coaching page in this same session — `app/(app)/coaching/page.tsx` has the working precedent.) All `profiles(...)` selects use explicit column lists — never `select('*')` — per the security fix already applied elsewhere in this codebase after a `password_hash`-leak incident.

"Unassigned people" for the Add flow are computed client-side, not a separate query: `allProfiles.filter(p => !teamMembers.some(tm => tm.profile_id === p.id))`.

## Components

```
app/(app)/team-leaders/
  layout.tsx          — role gate, mirrors app/(app)/coaching/layout.tsx (role !== 'management' → redirect('/dashboard'))
  page.tsx             — server component, the 4 fetches above, passes flat arrays to TeamLeadersBoard

components/team-leaders/
  TeamLeadersBoard.tsx — 'use client', DndContext + all mutation handlers + per-team view-model derivation, renders one TeamColumn per team
  TeamColumn.tsx       — one team's section: header, leader-slot droppable, member-list droppable, "+ Add" button
  PersonCard.tsx       — draggable card (avatar, name, role/department/inactive badges) + Edit/Deactivate icon buttons
  EditPersonModal.tsx  — full_name / department / role form
  AddToTeamModal.tsx   — pick from unassigned people, assign to this column's team
```

One derived (non-database) type in `types/index.ts`:
```ts
export interface TeamBoardColumn {
  team: Team
  leader: (Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'> & { teamLeaderRowId: string }) | null
  members: Profile[]
}
```

## Mutations

All run in `TeamLeadersBoard.tsx` via the browser Supabase client + `router.refresh()` — no API routes, matching this codebase's convention.

Investigated whether a team leader is required to also hold a `team_members` row for their own team: **no DB invariant enforces this** — `team_leaders` and `team_members` are independent tables everywhere else in this codebase (`AssignTeamLeaderModal` only ever touches `team_leaders`; `app/(app)/roster/page.tsx` queries them as two unrelated things). This page's "move a leader" action will *also* keep their `team_members` row in sync with their new team — not because anything requires it, but because leaving it stale would silently drop them from Roster's schedule view and Coaching's own per-leader agent list.

**Move a regular agent to a different team:**
```ts
await supabase.from('team_members')
  .upsert({ profile_id, team_id: newTeamId, joined_at: new Date().toISOString() }, { onConflict: 'profile_id' })
```

**Move someone into a team's leader slot** (leaving their old leadership, if any, and keeping their membership in sync):
```ts
if (oldTeamIdTheyLed) {
  await supabase.from('team_leaders').delete().eq('team_id', oldTeamIdTheyLed).eq('profile_id', personId)
}
await supabase.from('team_leaders')
  .upsert({ team_id: newTeamId, profile_id: personId, assigned_by: currentUserId }, { onConflict: 'team_id' })
await supabase.from('team_members')
  .upsert({ profile_id: personId, team_id: newTeamId, joined_at: new Date().toISOString() }, { onConflict: 'profile_id' })
```
The explicit delete-by-old-team-id step is necessary because `upsert(..., { onConflict: 'team_id' })` only replaces whoever currently leads the *new* team — it does nothing to a different team_id row for the same profile, so without this step a "move" would silently turn into "add a second team led."

**Auto-promote on drop into a leader slot**, when the dragged person's `role !== 'admin'`:
```ts
if (person.role !== 'admin') {
  await supabase.from('profiles').update({ role: 'admin' }).eq('id', personId)
}
// then the "move into leader slot" mutation above
```
Order matters — promote first, or the `enforce_team_leader_is_admin()` trigger rejects the `team_leaders` write. There's no transaction wrapper (this codebase doesn't use RPCs/transactions anywhere); if the second call fails after the first succeeds, the UI should surface the error and `router.refresh()` to resync from whatever the DB actually ended up in, rather than trusting stale optimistic state.

**Deactivate ("Delete" button, relabeled):**
```ts
await supabase.from('profiles').update({ is_active: false }).eq('id', personId)
```
Same shape as the existing admin page's toggle. Labeled "Deactivate" with a non-alarming icon (not a trash can), since nothing is actually deleted.

**Edit profile fields:**
```ts
await supabase.from('profiles').update({ full_name, department, role }).eq('id', personId)
```
**Guard required**: if the person being edited currently leads a team and their role is being changed away from `admin`, the modal must block the change (or explicitly clear their `team_leaders` row first) — the `enforce_team_leader_is_admin` trigger only fires on writes *to* `team_leaders`, not on `profiles` updates, so without this guard a role edit could silently leave a dangling leader row pointing at a non-admin.

**Add an unassigned person to a team:**
```ts
await supabase.from('team_members')
  .upsert({ profile_id: personId, team_id }, { onConflict: 'profile_id' })
```
Upsert (not a plain insert) as a defensive measure against a second manager having assigned the same person moments earlier.

## Navigation + routing

`components/layout/Sidebar.tsx`'s `getPrimaryLinks(role)` (already extended once for Coaching) gets the same ternary treatment on the Callbacks entry:
```ts
role === 'management'
  ? { href: '/team-leaders', label: 'Team Leaders Management', icon: Users2 }
  : { href: '/callbacks', label: 'Callbacks', icon: Phone },
```

`proxy.ts` gets a new block mirroring the existing `/coaching` one:
```ts
if (pathname.startsWith('/team-leaders') && profile?.role !== 'management') {
  return NextResponse.redirect(new URL('/dashboard', request.url))
}
```
`/callbacks` itself is not gated — same precedent as `/customers`: the route stays reachable, only the nav link and management's own usage pattern change; agent and admin dashboards/pages that depend on the `callbacks` table are completely unaffected.

## Task breakdown

1. **Schema/RLS migration** — write and run the migration above; verify live that a `management` session can now write to all three tables and an `agent` session still cannot.
2. **Types + query layer** — `TeamBoardColumn` type; `app/(app)/team-leaders/{layout,page}.tsx`.
3. **Read-only board** — `TeamLeadersBoard`, `TeamColumn`, `PersonCard` rendering the grouped layout with no interactivity yet; verify the visual pass before adding drag behavior.
4. **Drag-and-drop wiring** — add the two `@dnd-kit` packages; `DndContext`/`useDroppable`/`useDraggable`; `onDragEnd` dispatching to the four move/promote mutations; manually test all drop combinations (agent→team, leader→team, agent→leader-slot, leader→leader-slot).
5. **Modals** — `EditPersonModal` (with the demotion guard) and `AddToTeamModal`; wire the Deactivate action directly on the card.
6. **Nav/routing wiring** — `Sidebar.tsx` and `proxy.ts` changes above.
7. **Manual verification pass** (no automated test suite exists in this project, per `CLAUDE.md`).

## Verification approach

- Live-run the migration; confirm via direct query that a `management` session can write to `profiles`/`team_members`/`team_leaders` and an `agent` session still cannot (mirrors how the Coaching page's RLS was verified).
- Log in as `management`: confirm the sidebar shows "Team Leaders Management" not "Callbacks," and the board renders every team with correct members/leader.
- Log in as `agent`/`admin`: confirm their sidebar and `/callbacks` page are pixel-identical to before this feature, and that `/team-leaders` redirects them to `/dashboard`.
- Drag an agent to a different team; confirm their `team_members` row moved and their old team's member list no longer shows them.
- Drag a team leader to a different team; confirm they now lead the new team, no longer lead the old one, and both `team_leaders` and `team_members` reflect it.
- Drag a plain agent into a leader slot; confirm they're now `role = 'admin'` and the team's leader, and the previous leader (if any) is no longer marked as leading that team.
- Try editing a current team leader's role away from `admin`; confirm the guard blocks it or correctly clears their leadership.
- Deactivate someone; confirm `is_active` flips and no row is actually deleted.
- Add an unassigned person to a team; confirm they disappear from the "unassigned" pool and appear in that team's member list.
