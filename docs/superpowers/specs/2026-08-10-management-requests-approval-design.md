# Management Approval of Team-Leader Leave/Overtime Requests

## Context

The Roster page's "Requests" button currently does one of two things per role: `admin` (which includes team leaders — a team leader is just an admin-role profile with a `team_leaders` row) opens `TeamRequestsModal`, the approval view for their team's agent-submitted requests; every other role, including `management`, opens `RequestsPanel`, the Leave/Overtime submission form. For `management` this is useless — they never submit requests for themselves, so the button does nothing worth doing.

The actual need: admins (including team leaders) should be able to submit their own Leave/Overtime requests, and `management` should approve or deny them, reusing the exact approval mechanics team leaders already use on agent requests. This was scoped through a clarifying-questions pass; the below reflects explicit user choices, not assumptions:

- Admins get **one panel with two tabs** — "My Requests" (submit) and "Team Requests" (approve their agents, unchanged) — not two separate buttons.
- Management's approval scope is **team-leader-submitted requests only**, not every admin-submitted request. A plain admin who doesn't lead a team stays in the existing admin-only approval pool, unchanged (any admin already sees/approves all unscoped pending requests today — that pre-existing behavior is untouched).
- Submitting a request as a team leader **auto-notifies every management-role profile**, mirroring the existing agent→team-leader auto-notify trigger.

I verified the current implementation directly rather than trusting summary:
- `components/roster/RosterManager.tsx` (full read) — confirmed the exact `isAdmin`/`isTeamLeader` branching, the `scopedPendingRequests` memo (unscoped for non-team-leading admins, team_id-filtered for team leaders), and the single `isAdmin ? <TeamRequestsModal/> : <RequestsPanel/>` render branch.
- `components/requests/RequestsPanel.tsx` and `components/roster/admin/TeamRequestsModal.tsx` (full reads) — both are fully self-contained overlay components (their own backdrop, animation, header, close button) with no existing split between "chrome" and "content." `TeamRequestsModal` does zero scoping itself — it renders whatever `requests` array it's handed, which is exactly what makes it reusable as-is for management with a differently-scoped list.
- `app/(app)/roster/page.tsx` (full read) — confirmed `myRequests` (the current user's own submitted requests) is already fetched unconditionally for every role today, just never rendered by `RequestsPanel` (a currently-unused prop) — no page-query change needed to make "My Requests" submission work for admins, since the submission form/insert path (`LeaveRequestForm`/`OvertimeRequestForm`) already works for any authenticated profile regardless of role. Confirmed `pendingRequests`/`teamLeaderTeamIds` are fetched **only** for `profile.role === 'admin'` — this is the one query gate that needs a management branch.
- `supabase/requests-schema.sql` and `supabase/team-leaders-schema.sql` (full reads) — confirmed the exact, currently-live RLS policy text for `requests`/`leave_requests`/`overtime_requests`/`overtime_entries` (SELECT/UPDATE: `profile_id = auth.uid() OR is_team_leader_for(team_id) OR EXISTS(...role='admin'...)`) and `request_approval_history` (SELECT: requester OR `is_team_leader_for(r.team_id)` OR admin; INSERT: **admin only**, no `changed_by` check). Confirmed `is_team_leader_for(team_id)` checks whether **the current user** leads a given team — it cannot be reused for "is this submitter a team leader," which is the actual predicate this feature needs, since management doesn't lead any team themselves.
- Confirmed a team leader's own submitted request has `team_id = null` in practice: `LeaveRequestForm`/`OvertimeRequestForm` derive `team_id` from `userTeam`, which is computed by matching the submitter against `team_members` rows (agent roster membership) — team leaders aren't `team_members`, so `userTeam` resolves to `null` for them. This means the existing `notify_team_leader_on_request` trigger (which no-ops when `team_id IS NULL`) already correctly does nothing for a team leader's own submission, and no changes to the submission forms are needed.

## Key decisions

- **New helper function, not a reuse of `is_team_leader_for`**: `is_submitter_team_leader(p_profile_id uuid)` checks `EXISTS (SELECT 1 FROM team_leaders WHERE profile_id = p_profile_id)` — a different predicate (is the *subject profile* a team leader) from the existing `is_team_leader_for(p_team_id)` (does *the current user* lead *this team*). Naming distinguishes them deliberately.
- **No new tables, no column changes.** Same `requests`/`leave_requests`/`overtime_requests`/`overtime_entries`/`request_approval_history` tables; only RLS policies are widened and one new trigger is added.
- **`team_id` is left `null` for admin/team-leader submissions** — no changes to `LeaveRequestForm.tsx` or `OvertimeRequestForm.tsx`. Management's scoping is entirely profile-based (`is_submitter_team_leader(profile_id)`), so it doesn't need a team_id at all.
- **Existing admin approval behavior is completely unaffected** — this is purely additive. Any admin still sees/approves every pending request unscoped exactly as today (including, unchanged, the pre-existing quirk that a non-team-leading admin can see their own submitted request in their own "Team Requests" tab — out of scope to fix here). Management's new queue is a second, narrower lens onto the same table, not a replacement.
- **Component split: extract content from chrome, not a full rewrite.** `TeamRequestsModal` and `RequestsPanel` both currently hard-couple their overlay/animation/header ("chrome") to their list/form logic ("content"). Splitting them lets the new admin tabbed panel reuse the *exact same* approval and submission logic without duplicating it, while leaving both existing standalone components' behavior for agents and management byte-identical to today.
- **Management reuses `TeamRequestsModal` verbatim** — same component, same props (`open`, `onClose`, `requests`, `currentUserId`, `onRefresh`), just fed a management-scoped `requests` array from the page query. Zero code changes to `TeamRequestsModal` are needed for the management case itself (only the content-extraction refactor, which is chrome-preserving).
- **Notification recipients: all `management`-role profiles, not one.** Team leaders map 1:1 to a team (`UNIQUE (team_id)` on `team_leaders`), so the existing trigger picks a single recipient via `LIMIT 1`. Management has no such uniqueness constraint — there can be more than one management account — so the new trigger loops over every `management`-role profile and inserts one notification per recipient.

## Data model — `supabase/migrations/management-requests-access.sql`

```sql
-- ============================================================
-- Let 'management' approve/reject Leave & Overtime requests
-- submitted by team leaders (not by plain, non-leading admins,
-- whose requests stay in the existing admin-only approval pool
-- unchanged). Also auto-notifies every management-role profile
-- when a team leader submits a request, mirroring the existing
-- agent -> team-leader notify trigger.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — no data changes; RLS policies
-- are dropped/recreated; the new function/trigger are additive.
-- ============================================================

-- ─── 1. Helper: is the SUBJECT profile a team leader? ─────────────────────────
-- Distinct from the existing is_team_leader_for(team_id), which checks
-- whether the CURRENT user leads a given team. This checks whether an
-- arbitrary profile (the request's submitter) leads ANY team.

CREATE OR REPLACE FUNCTION is_submitter_team_leader(p_profile_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_leaders WHERE profile_id = p_profile_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- ─── 2. Widen RLS on requests ──────────────────────────────────────────────

DROP POLICY IF EXISTS "requests_select" ON requests;
CREATE POLICY "requests_select" ON requests FOR SELECT TO authenticated USING (
  profile_id = auth.uid()
  OR is_team_leader_for(team_id)
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
    AND is_submitter_team_leader(profile_id)
  )
);

DROP POLICY IF EXISTS "requests_update" ON requests;
CREATE POLICY "requests_update" ON requests FOR UPDATE TO authenticated USING (
  profile_id = auth.uid()
  OR is_team_leader_for(team_id)
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
    AND is_submitter_team_leader(profile_id)
  )
);

-- ─── 3. Widen RLS on leave_requests ────────────────────────────────────────

DROP POLICY IF EXISTS "leave_requests_select" ON leave_requests;
CREATE POLICY "leave_requests_select" ON leave_requests FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = leave_requests.request_id
      AND (
        r.profile_id = auth.uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);

DROP POLICY IF EXISTS "leave_requests_update" ON leave_requests;
CREATE POLICY "leave_requests_update" ON leave_requests FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = leave_requests.request_id
      AND (
        r.profile_id = auth.uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);

-- ─── 4. Widen RLS on overtime_requests ─────────────────────────────────────

DROP POLICY IF EXISTS "overtime_requests_select" ON overtime_requests;
CREATE POLICY "overtime_requests_select" ON overtime_requests FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = overtime_requests.request_id
      AND (
        r.profile_id = auth.uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);

DROP POLICY IF EXISTS "overtime_requests_update" ON overtime_requests;
CREATE POLICY "overtime_requests_update" ON overtime_requests FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = overtime_requests.request_id
      AND (
        r.profile_id = auth.uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);

-- ─── 5. Widen RLS on overtime_entries ───────────────────────────────────────

DROP POLICY IF EXISTS "overtime_entries_select" ON overtime_entries;
CREATE POLICY "overtime_entries_select" ON overtime_entries FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM overtime_requests ot
    JOIN requests r ON r.id = ot.request_id
    WHERE ot.id = overtime_entries.overtime_request_id
      AND (
        r.profile_id = auth.uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);

DROP POLICY IF EXISTS "overtime_entries_update" ON overtime_entries;
CREATE POLICY "overtime_entries_update" ON overtime_entries FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM overtime_requests ot
    JOIN requests r ON r.id = ot.request_id
    WHERE ot.id = overtime_entries.overtime_request_id
      AND (
        r.profile_id = auth.uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);

-- ─── 6. Widen RLS on request_approval_history ──────────────────────────────

DROP POLICY IF EXISTS "approval_history_select" ON request_approval_history;
CREATE POLICY "approval_history_select" ON request_approval_history FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_approval_history.request_id
      AND r.profile_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_approval_history.request_id
      AND is_team_leader_for(r.team_id)
  )
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
    AND EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_approval_history.request_id
        AND is_submitter_team_leader(r.profile_id)
    )
  )
);

DROP POLICY IF EXISTS "approval_history_insert" ON request_approval_history;
CREATE POLICY "approval_history_insert" ON request_approval_history FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
    AND EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_approval_history.request_id
        AND is_submitter_team_leader(r.profile_id)
    )
  )
);

-- ─── 7. Auto-notify every management profile when a team leader submits ────
-- Mirrors notify_team_leader_on_request, but the recipient pool has no
-- natural 1-per-team uniqueness the way team_leaders does, so this loops
-- over every management-role profile instead of picking a single LIMIT 1.

CREATE OR REPLACE FUNCTION notify_management_on_team_leader_request()
RETURNS TRIGGER AS $$
DECLARE
  v_requester_name text;
  v_type_label     text;
  v_mgmt           record;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF NOT is_submitter_team_leader(NEW.profile_id) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT full_name INTO v_requester_name FROM profiles WHERE id = NEW.profile_id;

    v_type_label := CASE NEW.type
      WHEN 'leave'    THEN 'leave'
      WHEN 'overtime' THEN 'overtime'
      ELSE NEW.type
    END;

    FOR v_mgmt IN SELECT id FROM profiles WHERE role = 'management' LOOP
      INSERT INTO notifications (
        recipient_id, sender_id, request_id, title, message, type
      ) VALUES (
        v_mgmt.id,
        NEW.profile_id,
        NEW.id,
        'New ' || v_type_label || ' request',
        COALESCE(v_requester_name, 'A team leader') || ' has submitted a ' || v_type_label || ' request requiring your review.',
        'request'
      );
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_notify_management_on_team_leader_request
  AFTER INSERT ON requests
  FOR EACH ROW EXECUTE FUNCTION notify_management_on_team_leader_request();
```

No `ALTER TABLE` statements — every column already exists.

## Query layer — `app/(app)/roster/page.tsx`

PostgREST can't express "requests whose submitter is a team leader" as a single inline subquery, so the management case needs the list of team-leader profile IDs before it can fetch `pendingRequests` — an extra sequential step after the page's existing big `Promise.all`. `teamLeaderTeamIds` (used only to scope an admin-who-leads-a-team's own "Team Requests" tab) stays inside that `Promise.all`, admin-only, exactly as today; only `pendingRequests` moves out to a step that can branch on the now-resolved role:

```ts
const isAdmin = profile.role === 'admin'
const isManagement = profile.role === 'management'

const [
  { data: teams },
  { data: allProfiles },
  { data: shiftTemplates },
  { data: rotations },
  { data: attendanceRecords },
  { data: overrides },
  { data: myRequests },
  { data: teamLeaderRows },
] = await Promise.all([
  // ...unchanged existing queries for teams, allProfiles, shiftTemplates,
  // rotations, attendanceRecords, overrides, myRequests...
  isAdmin
    ? supabase.from('team_leaders').select('team_id').eq('profile_id', userId)
    : Promise.resolve({ data: [] }),
])

// pendingRequests depends on a role check plus, for management, a prior
// query result — can't join the parallel batch above.
let pendingRequests: RequestWithDetail[] = []
if (isAdmin) {
  const { data } = await supabase
    .from('requests')
    .select(requestDetailSelect)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  pendingRequests = (data ?? []) as RequestWithDetail[]
} else if (isManagement) {
  const { data: teamLeaderProfileRows } = await supabase.from('team_leaders').select('profile_id')
  const teamLeaderProfileIds = [...new Set((teamLeaderProfileRows ?? []).map(r => r.profile_id))]
  if (teamLeaderProfileIds.length) {
    const { data } = await supabase
      .from('requests')
      .select(requestDetailSelect)
      .eq('status', 'pending')
      .in('profile_id', teamLeaderProfileIds)
      .order('created_at', { ascending: false })
    pendingRequests = (data ?? []) as RequestWithDetail[]
  }
}
```

The RLS policies in the migration above are what actually enforce the boundary — this query shape only determines what's *offered* to the UI; a bug here fails closed (empty list), never open, because Postgres still checks every row against the widened policies regardless of how the query is constructed.

`teamLeaderTeamIds` stays admin-only (unchanged) — management has no use for it, since their scoping is profile-based, not team-based.

`RosterPageData` (`types/index.ts`) gains no new required fields — `pendingRequests` is reused for both admin and management, just populated differently server-side.

## Component design

**`components/roster/admin/TeamRequestsBody.tsx`** (new) — everything currently inside `TeamRequestsModal`'s body from the tab bar down through the request list, approve/reject handlers, and the `RequestReviewDrawer` integration: unchanged. Props: `{ requests: RequestWithDetail[], currentUserId: string, onRefresh: () => void }`.

**`components/roster/admin/TeamRequestsModal.tsx`** (modified) — becomes a thin shell: overlay, animation, header (title/close button), renders `<TeamRequestsBody requests={requests} currentUserId={currentUserId} onRefresh={onRefresh} />` in place of its old inline body. Same external props, same behavior, used standalone for admin's "Team Requests" tab and reused as-is for management.

**`components/requests/MyRequestsBody.tsx`** (new) — everything currently inside `RequestsPanel`'s body: the leave/overtime sub-tab switcher and the two forms. Props: `{ profile: Profile, userTeam: Team | null, onSuccess: () => void }`.

**`components/requests/RequestsPanel.tsx`** (modified) — becomes a thin shell: overlay, animation, header, renders `<MyRequestsBody profile={profile} userTeam={userTeam} onSuccess={onSuccess} />`. Same external props (`isAdmin`/`myRequests` props become unused — see Files NOT modified below for why they're left alone rather than removed), used standalone for agents, unchanged.

**`components/roster/admin/AdminRequestsPanel.tsx`** (new) — the only genuinely new UI. One modal shell (reuses the same overlay/animation pattern as `TeamRequestsModal`, since it's replacing that button's admin behavior) with a top-level 2-tab switcher: "My Requests" renders `<MyRequestsBody profile={profile} userTeam={userTeam} onSuccess={...} />`; "Team Requests" renders `<TeamRequestsBody requests={requests} currentUserId={currentUserId} onRefresh={onRefresh} />`, using this component's own `requests`/`currentUserId` props (received from `RosterManager`, populated from its `scopedPendingRequests`/`profile.id` — not a variable local to this component). Props: `{ open, onClose, profile, userTeam, requests, currentUserId, onRefresh }`.

**`components/roster/RosterManager.tsx`** (modified) — the render branch becomes three-way:

```tsx
{isManagement ? (
  <TeamRequestsModal
    open={requestsPanelOpen}
    onClose={() => setRequestsPanelOpen(false)}
    requests={scopedPendingRequests}
    currentUserId={profile.id}
    onRefresh={() => router.refresh()}
  />
) : isAdmin ? (
  <AdminRequestsPanel
    open={requestsPanelOpen}
    onClose={() => setRequestsPanelOpen(false)}
    profile={profile}
    userTeam={userTeam}
    requests={scopedPendingRequests}
    currentUserId={profile.id}
    onRefresh={() => router.refresh()}
  />
) : (
  <RequestsPanel
    open={requestsPanelOpen}
    onClose={() => setRequestsPanelOpen(false)}
    onSuccess={handleSuccess}
    profile={profile}
    userTeam={userTeam}
    isAdmin={false}
    myRequests={myRequests ?? []}
  />
)}
```

`scopedPendingRequests`'s existing team_id-based filtering (`isAdmin && isTeamLeader`) is untouched — it already produces the right list for admin's "Team Requests" tab. For management, since `pendingRequests` is now server-scoped to team-leader submissions already (see Query layer above), no additional client-side filtering is needed — management's `scopedPendingRequests` is just `pendingRequests` passed straight through (the existing memo's `!isAdmin` early-return path already does this for any non-admin role, so it needs no code change, just a new true branch to reach `TeamRequestsModal` with it).

The pending-count badge (`isAdmin && pendingCount > 0`) extends to `(isAdmin || isManagement) && pendingCount > 0`.

## Files explicitly NOT modified (and why)

- `components/requests/LeaveRequestForm.tsx`, `OvertimeRequestForm.tsx` — the insert logic already works for any authenticated profile; `team_id` naturally resolves to `null` for admin/team-leader submitters with no code change (see Context above).
- `components/requests/admin/RequestReviewDrawer.tsx` — untouched; `TeamRequestsBody` renders it exactly as `TeamRequestsModal` does today, just relocated.
- `RequestsPanel`'s `isAdmin`/`myRequests` props — left in place unused rather than removed. They were already unused today (per the Context section — `myRequests` was threaded through but never rendered), so removing them is a pre-existing cleanup opportunity, not something this feature needs to touch.
- `supabase/schema.sql`, `requests-schema.sql`, `team-leaders-schema.sql` — no in-place edits; all changes live in the new migration file per established convention.
- `proxy.ts`, `components/layout/Sidebar.tsx` — `/roster` is already reachable by every role with no route-level gating; nothing to change.
- `app/(app)/admin/requests/page.tsx` and its components — the separate `/admin/requests` full-page approval surface (admin-only, gated by `proxy.ts`) is untouched; this feature only changes the Roster page's "Requests" button.

## Verification approach

No automated test suite exists in this project (per `CLAUDE.md`). All verification is manual:

- Live-run the migration; confirm no errors.
- Log in as `agent`: confirm the Roster page's Requests button is pixel-for-pixel unchanged (submission panel only).
- Log in as a plain `admin` (no `team_leaders` row): confirm the new two-tab panel opens; "My Requests" submits successfully; "Team Requests" still shows every pending request unscoped, exactly as before.
- Log in as an `admin` who **is** a team leader: confirm "My Requests" submits a request with `team_id = null`; confirm it does NOT appear in their own "Team Requests" tab (still scoped to their team's agents only); confirm every `management`-role profile receives a notification.
- Log in as `management`: confirm the Requests button now opens the approval view, showing only the team leader's just-submitted request (not any plain-admin-submitted request); approve it; confirm `reviewed_by`/`reviewed_at` are set and a `request_approval_history` row is written.
- Confirm a plain admin's own submitted request is still only visible/approvable through the existing admin pool, NOT through management's view.
- Confirm the pending-count badge shows the correct scoped count for both admin and management.
