# Warnings System

## Context

There is currently no way to record disciplinary warnings anywhere in this app. The need: team leaders issue warnings (verbal/written/final) to their own agents, and management issues warnings to team leaders — the exact same one-level hierarchy already built for Leave/Overtime request approval (agent→team-leader, team-leader→management), just inverted in direction (a superior *issues* a warning *about* a subordinate, rather than a subordinate *submitting* something *for* a superior to approve). A new `/warnings` page shows a stat-tile dashboard plus a browsable, editable list, visible only to `admin`- and `management`-role profiles — never `agent`.

This was scoped through a clarifying-questions pass; the below reflects explicit user choices, not assumptions:
- Every warning has a **required reason field** — a warning with no text content isn't a useful record.
- Warnings are **mutable**: whoever issued a warning can edit or delete it later (a deliberate departure from every other audit-trail table built in this app so far, which are all immutable).
- **Plain admins** (admin-role profiles with no `team_leaders` row) get the *same* console as a team leader — an agents-only view with full create/edit/delete rights — just **unscoped**: they can warn any agent org-wide, not just one team's agents. This is the opposite of the "admin sees everything, including team-leader data" bypass used in every other feature built this session — here, a plain admin explicitly does **not** get visibility into team-leader-directed warnings at all, only management does.
- On management's dashboard, only the **"Total recorded warnings" tile splits agent vs. team-leader** counts into two numbers. The three type tiles (Verbal/Written/Final) each show one **combined** count across both audiences.
- Management can browse a **full list of every warning in the org** (both agent-directed and team-leader-directed), not just the aggregate counts — matching the "keep track and records of all warnings" framing of the original request.
- The **warned person themselves gets zero visibility** into their own record through this system, whether they're an agent or a team leader — consistent with "team leaders see agents' warnings, not their own," extended the same way to agents (who have no access to this page at all).

I verified two load-bearing claims directly against the actual code rather than assuming:
- `is_submitter_team_leader(p_profile_id uuid)` already exists live in the database (added by the management-requests-approval migration on this same project) and does exactly what this feature needs: `EXISTS (SELECT 1 FROM team_leaders WHERE profile_id = p_profile_id)`. This is reused as-is, not reimplemented — one function answers "is this profile a team leader" for both features.
- The `team_leaders`→`team_members` join path (a team leader's `profile_id` → their `team_leaders.team_id` row(s) → `team_members` rows sharing that `team_id` → agent `profile_id`s) is the exact pattern already used in `components/coaching/CoachingManager.tsx:33-55` for "which agents does this team leader manage" — reused here, not reinvented.

## Key decisions

- **One shared `warnings` table**, not two separate tables for "agent warnings" and "team-leader warnings" — the row's `issued_to` profile's role already distinguishes the two categories, and every dashboard/list query is a filter on the same table, not a union of two.
- **RLS carries the entire scoping logic; the page query does not re-filter.** Every other role-scoped feature built this session (requests, followups) had the page query replicate some of the RLS scoping logic for query efficiency. Here, because the visibility rules are simple set-membership checks (not "my own row" style joins that benefit from server-side pre-filtering), the page just does one unfiltered `select *` and RLS alone determines exactly which rows come back — simpler, and impossible for the query layer to drift out of sync with the security boundary.
- **One shared `WarningModal` for create+edit across all three issuer types** (team leader, plain admin, management) — unlike the management-followups feature, which forked a whole separate modal because the field set diverged heavily, here all three issuers need exactly the same three fields (target picker, type, reason). Only the *target-candidate list* passed into the picker varies by role, following the same "candidates as a prop" pattern already used for `FollowupAssignee` in the management-followups feature.
- **Edit/delete rights are `issued_by = auth.uid()` only, independent of role or view scope.** Management can see an agent-directed warning (per the "full list, both audiences" decision) but cannot edit or delete it, since they didn't issue it — the list UI hides edit/delete controls on any row where `issued_by !== currentUserId`.
- **Notifications reuse the established insert-then-notify pattern** (`EscalationManager.handleSend`'s shape: insert the primary row, check its error; insert the notification, don't check its error) — the warned person gets a `notifications` row even though they can never browse a page to see their own warning history, matching how this app already notifies people about things they can't necessarily self-serve view in full.
- **`/warnings` is a new nav entry and route, gated the same way `/admin/*` and `/coaching` already are** — a `proxy.ts` block redirecting `agent` role away, and a Sidebar entry visible to everyone except `agent`.

## Data model — `supabase/migrations/warnings-schema.sql`

```sql
-- ============================================================
-- Warnings: team leaders issue verbal/written/final warnings to
-- their own team's agents; plain (non-leading) admins issue them
-- to any agent org-wide; management issues them to team leaders.
-- Reuses is_submitter_team_leader(profile_id), already live from
-- the management-requests-approval migration, to answer "is this
-- profile a team leader" for both the issuer and the target side
-- of each check.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — additive only.
-- ============================================================

CREATE TABLE warnings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  issued_to   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  issued_by   uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  type        text        NOT NULL CHECK (type IN ('verbal', 'written', 'final')),
  reason      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_warnings_issued_to  ON warnings (issued_to);
CREATE INDEX idx_warnings_issued_by  ON warnings (issued_by);
CREATE INDEX idx_warnings_type       ON warnings (type);
CREATE INDEX idx_warnings_created_at ON warnings (created_at);

-- Reuse the set_updated_at() function already created by schema.sql
CREATE TRIGGER trg_warnings_updated_at
  BEFORE UPDATE ON warnings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE warnings ENABLE ROW LEVEL SECURITY;

-- INSERT: issuer must actually be entitled to warn this specific target.
CREATE POLICY "warnings_insert" ON warnings FOR INSERT TO authenticated WITH CHECK (
  issued_by = auth.uid()
  AND (
    -- Management warning a team leader
    (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
      AND is_submitter_team_leader(issued_to)
    )
    OR
    -- Team leader warning one of their own team's agents
    (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
      AND is_submitter_team_leader(auth.uid())
      AND EXISTS (
        SELECT 1 FROM team_members tm
        JOIN team_leaders tl ON tl.team_id = tm.team_id
        WHERE tl.profile_id = auth.uid() AND tm.profile_id = issued_to
      )
    )
    OR
    -- Plain (non-leading) admin warning any agent, unscoped
    (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
      AND NOT is_submitter_team_leader(auth.uid())
      AND EXISTS (SELECT 1 FROM profiles WHERE id = issued_to AND role = 'agent')
    )
  )
);

-- SELECT: same three-way scoping as INSERT, but keyed off the row's
-- issued_to rather than a WITH CHECK's incoming value, and management
-- gets blanket visibility (both audiences) rather than an issuer-only view.
CREATE POLICY "warnings_select" ON warnings FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    AND is_submitter_team_leader(auth.uid())
    AND EXISTS (
      SELECT 1 FROM team_members tm
      JOIN team_leaders tl ON tl.team_id = tm.team_id
      WHERE tl.profile_id = auth.uid() AND tm.profile_id = warnings.issued_to
    )
  )
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    AND NOT is_submitter_team_leader(auth.uid())
    AND EXISTS (SELECT 1 FROM profiles WHERE id = warnings.issued_to AND role = 'agent')
  )
);

-- UPDATE/DELETE: issuer only, regardless of role or view scope.
CREATE POLICY "warnings_update" ON warnings FOR UPDATE TO authenticated USING (issued_by = auth.uid());
CREATE POLICY "warnings_delete" ON warnings FOR DELETE TO authenticated USING (issued_by = auth.uid());
```

## Notifications — `supabase/migrations/warnings-notifications.sql`

```sql
-- ============================================================
-- Add 'warning' to the notifications type CHECK constraint, so a
-- warning's recipient can be notified — mirrors the existing
-- callback-notifications.sql pattern for adding a new type.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — no data changes.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('info', 'followup', 'escalation', 'reminder', 'request', 'callback', 'warning'));
```

No `notifications.warning_id` column is added — unlike `request_id`/`followup_id`/`callback_id`, nothing in this feature needs to deep-link a notification back to a specific warning row (the warned person can never open this page anyway), so the notification is informational only (`title`/`message`), matching `EscalationManager`'s own notification shape before `followup_id` was added there for a different reason.

## Types — `types/index.ts` additions

```ts
export type WarningType = 'verbal' | 'written' | 'final'

export interface Warning {
  id: string
  issued_to: string
  issued_by: string
  type: WarningType
  reason: string
  created_at: string
  updated_at: string
  target?: Pick<Profile, 'id' | 'full_name' | 'email'>
  issuer?: Pick<Profile, 'id' | 'full_name' | 'email'>
}

/** Shared shape for the "who can I warn" target-candidate pool */
export type WarningTargetCandidate = Pick<Profile, 'id' | 'full_name' | 'email'>
```

## Query layer — `app/(app)/warnings/page.tsx`

```ts
const supabase = await createClient()
const userId = await getCurrentUserId(supabase)
const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId!).single()

const isAdmin = profile?.role === 'admin'
const isManagement = profile?.role === 'management'

const { data: teamLeaderRows } = isAdmin
  ? await supabase.from('team_leaders').select('team_id').eq('profile_id', userId!)
  : { data: [] }
const isTeamLeader = (teamLeaderRows ?? []).length > 0

// RLS alone determines which rows come back — no manual filtering needed.
// target's role is included specifically so the client can split
// management's list into "Agent Warnings" vs "Team-Leader Warnings" by a
// simple target.role check ('agent' vs 'admin') — issued_to is never
// anything else, per the INSERT policy above.
const { data: warnings } = await supabase
  .from('warnings')
  .select('*, target:profiles!warnings_issued_to_fkey(id, full_name, email, role), issuer:profiles!warnings_issued_by_fkey(id, full_name, email)')
  .order('created_at', { ascending: false })

// Target-candidate pool for the "New Warning" picker, role-dependent.
let targetCandidates: WarningTargetCandidate[] = []
if (isManagement) {
  const { data: leaders } = await supabase
    .from('team_leaders')
    .select('profiles!team_leaders_profile_id_fkey(id, full_name, email)')
  const map = new Map<string, WarningTargetCandidate>()
  for (const row of leaders ?? []) {
    const p = row.profiles as unknown as WarningTargetCandidate | null
    if (p && !map.has(p.id)) map.set(p.id, p)
  }
  targetCandidates = Array.from(map.values())
} else if (isAdmin && isTeamLeader) {
  const teamIds = (teamLeaderRows ?? []).map(r => r.team_id)
  const { data: members } = await supabase
    .from('team_members')
    .select('profiles(id, full_name, email)')
    .in('team_id', teamIds)
  const map = new Map<string, WarningTargetCandidate>()
  for (const row of members ?? []) {
    const p = row.profiles as unknown as WarningTargetCandidate | null
    if (p && !map.has(p.id)) map.set(p.id, p)
  }
  targetCandidates = Array.from(map.values())
} else if (isAdmin) {
  const { data: agents } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'agent')
    .eq('is_active', true)
    .order('full_name')
  targetCandidates = agents ?? []
}
```

The dedup-via-`Map` pattern above (a team leader leading >1 team, or a leader whose team has multiple members, must not produce duplicate picker entries) matches the exact pattern already used for `teamLeaderCandidates` in `app/(app)/followups/page.tsx` from the management-followups feature — same shape, reused rather than reinvented. The `profiles!<table>_<column>_fkey` qualification is required because both `team_leaders` and `team_members` have more than one FK to `profiles` (`profile_id` and `assigned_by`/none respectively, but PostgREST still needs the explicit qualifier whenever ambiguity is possible) — the exact same gotcha hit twice already this session.

## Component design

**`components/warnings/WarningsManager.tsx`** (new, client) — the main page component. Props: `{ warnings: Warning[], targetCandidates: WarningTargetCandidate[], currentUserId: string, isManagement: boolean }`.
- Computes stat-tile counts by filtering/reducing the already-fetched `warnings` array client-side (no separate count queries — the array IS the full accessible set, by construction of the RLS-driven fetch above).
- **Non-management view** (team leader or plain admin — both get the identical component tree, since the only difference between them is already baked into what `warnings`/`targetCandidates` contain): 4 stat tiles (Total, Verbal, Written, Final), one flat browsable list, a "New Warning" button.
- **Management view**: 5 stat tiles (Total Agent Warnings, Total Team-Leader Warnings, Verbal, Written, Final — the last three combined across both audiences), a two-tab list ("Agent Warnings" / "Team-Leader Warnings", split by `target?.role === 'agent'` vs `'admin'` — the `role` field fetched alongside `target` in the page query above), a "New Warning" button.
- Stat tile visual style matches `components/dashboard/DashboardContent.tsx`'s existing tile pattern (`bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border ...`, icon chip + big number + label) minus the `Link` wrapper (these aren't navigation tiles).
- Each list row shows target name, type badge, reason, timestamp, issuer name; Edit/Delete buttons render only when `warning.issued_by === currentUserId`.

**`components/warnings/WarningModal.tsx`** (new) — create/edit form. Props: `{ open, onClose, editing: Warning | null, targetCandidates, currentUserId, onSaved }`. Fields: target `<select>` (from `targetCandidates`, disabled/pre-filled when editing since you can't retarget an existing warning to someone else — editing only changes type/reason), type `<select>` (verbal/written/final), reason `<textarea>`, required. On create: insert `warnings` row (error-checked), then insert a `notifications` row for `issued_to` (error not checked, matching `EscalationManager`). On edit: update the `warnings` row only (no re-notification).

## Files explicitly NOT modified (and why)

- `components/layout/Sidebar.tsx` — gets ONE new entry, not a restructure; exact insertion point pinned down in the plan since neither of the file's two existing per-role patterns (`adminLinks`, the `management`-only ternaries inside `getPrimaryLinks`) already expresses "visible to admin OR management, not agent."
- `proxy.ts` — gets one new block mirroring the existing `/coaching`/`/team-leaders` gates, just with the condition inverted (block `agent`, not "block everyone except one specific role").
- `components/coaching/CoachingManager.tsx`, `app/(app)/coaching/page.tsx` — untouched; only the team-leader→agents join *pattern* is reused, not the code.
- `supabase/schema.sql`, `supabase/team-leaders-schema.sql` — no in-place edits; all changes live in the two new migration files above.
- `components/admin/EscalationManager.tsx` — untouched; only the insert-then-notify *pattern* is reused.

## Verification approach

No automated test suite exists in this project (per `CLAUDE.md`) — verification is manual, consistent with every feature built this session:

- Live-run both migrations; confirm no errors.
- Log in as an agent: confirm `/warnings` redirects away and no nav link is shown.
- Log in as a team leader: confirm the 4-tile dashboard and list show only their own team's agents' warnings; issue a verbal warning to one of their agents; confirm it appears, the target agent receives a notification, and the counts update. Confirm they cannot see any team-leader-directed warning.
- Log in as a plain (non-leading) admin: confirm the same 4-tile shape but scoped to ALL agents; confirm they can warn an agent not on any particular team.
- Log in as management: confirm the 5-tile dashboard (Total Agent / Total Team-Leader split, combined Verbal/Written/Final), the two-tab list showing both audiences; issue a written warning to a team leader; confirm the team leader receives a notification and does NOT see it anywhere in their own (team-leader) view of `/warnings`.
- Confirm edit/delete controls only appear on rows the current user personally issued, and that attempting to edit/delete someone else's warning via a direct API call is rejected by RLS.
- Confirm a plain admin cannot see or act on any team-leader-directed warning, even though management can see agent-directed ones.
