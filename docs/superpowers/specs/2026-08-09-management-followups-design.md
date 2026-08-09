# Management-Assigned Follow-ups — Design

## Context

Management currently has essentially no usable Follow-ups page: `app/(app)/followups/page.tsx` filters every non-admin role (including `management`) down to `.eq('agent_id', userId)`, and `management` is never a followup's assigned agent — so the page renders empty for them today, and `management` also has zero RLS grant on the `followups` table (unlike every other table widened for them this session).

The actual product need: management doesn't personally work follow-ups with customers — they create a follow-up and **assign** it to an agent or team leader to work, similar in spirit to the existing admin-only Escalations feature (assign-to-agent + notify), but as a first-class part of the regular Follow-ups page/table rather than a separate escalations-only flow. The Add Follow-up modal needs a different field set for management: drop Priority, Possible Solution, Due Date (manual), and Resolution Notes; keep Query Description; add an inline "create a new customer" option and a combined "assign to agent or team leader" picker; and — because there's no status-change history anywhere in this table today — add a real timeline so anyone looking at a follow-up can see when it moved from open → in progress → resolved, not just its current status.

This was scoped through a clarifying-questions pass with the user; the below reflects their explicit choices, not assumptions:
- Status changes get a full history timeline (new table), not just a single "last changed" timestamp.
- The manual Due Date field is removed entirely; assignment date is just the row's own `created_at` (no new column needed).
- Customer creation is inline quick-add fields (Name + Phone) in the same modal, not a nested second modal.
- Assignment is ONE combined "Assign to" dropdown (agents + team leaders together), and the assignee gets a `notifications` row.
- Management keeps a list view of what they've assigned and CAN still edit it afterward (reassign, change status) — not read-only.

Two load-bearing claims were verified directly against the actual files rather than trusted from summary/memory:
- `components/followups/FollowupManager.tsx` (full file read) — confirmed the exact current Add/Edit modal fields, the `empty` form-state shape, `statusBadge`/`priorityBadge` maps, and that `agent_id` is hardcoded to the creator on insert (no assignee picker exists today).
- `supabase/team-leaders-schema.sql` (full relevant section read) — confirmed `request_approval_history` is written via a plain app-level `.insert()` in `TeamRequestsModal.tsx`'s `insertApprovalHistory()` helper, **not** a DB trigger (the only trigger in that file, `notify_team_leader_on_request`, writes to `notifications`, not the history table). This directly determines the mechanism below: the new `followup_status_history` table is written the same way, via a small shared helper, not a trigger.

## Key decisions

- **`FollowupManager.tsx` is extended, not forked, for the shared list/filter view** — new props (`isManagement`, `agentCandidates`, `teamLeaderCandidates`, `statusHistory`) all default to `false`/`[]`, so the agent/admin code path is provably unchanged (matches the `TeamLeadersBoard`/`isAdminView` precedent from earlier this session).
- **The Add/Edit modal itself is forked into a new sibling component**, `ManagementFollowupModal.tsx`, rendered instead of the legacy `<Modal>` block only when `isManagement` is true. The field-set divergence is too large (4 fields removed, 2 added, inline customer creation, combined picker) for one heavily-conditional modal to stay readable — matches this codebase's own precedent of separate modal files for genuinely different flows on the same board (`AddToTeamModal.tsx` vs `AddTeamLeaderModal.tsx`).
- **Status history is universal**, not management-only: every followup's status changes get logged regardless of who created the row. It's a generic audit-trail improvement to a shared table, the write is one cheap insert at both existing status-changing call sites, and gating it by role would produce inconsistent coverage for no benefit.
- **History write mechanism: app-level insert via a small shared helper**, `lib/followups/insertFollowupHistory.ts` — called from both the legacy `updateStatus`/`handleSave` paths and the new modal. Fire-and-forget, no error surfaced, deliberately matching `insertApprovalHistory`'s own lack of error handling for consistency with the verified precedent.
- **New RLS migration** `supabase/migrations/management-followups-access.sql` (matching the established `management-*-access.sql` naming/style already used repeatedly this session) widens `followups` SELECT/UPDATE to include `management`, and creates+secures the new `followup_status_history` table. The existing INSERT policy (`WITH CHECK (created_by = auth.uid())`) already permits management to insert rows with a different `agent_id` — no change needed there.
- **No Sidebar or `proxy.ts` changes** — Follow-ups is already the one primary nav entry that's unconditional for every role, and that's correct: agent/admin/management all legitimately need `/followups`, just with different page-level behavior (unlike `/coaching`/`/team-leaders`, which are genuinely management-exclusive routes).
- **"Assigned today" reuses `created_at`** — no new column. The requirement was "no manual due-date input, auto-stamp instead," and a freshly-created row's own `created_at` already is that; a separate `assigned_at` would only earn its keep if reassignment needed to reset an "assigned since" date, which isn't a stated requirement.
- **Admin's experience is completely unaffected** — `isManagement` only ever becomes `true` for `management`-role sessions; admin keeps the full legacy field set (Priority, Possible Solution, Due Date, Resolution Notes) and self-working behavior exactly as today. This does not touch `EscalationManager.tsx`/`admin/escalations` at all — only its assign+notify *pattern* is reused, not its code.

## Data model — `supabase/migrations/management-followups-access.sql`

```sql
-- ============================================================
-- Widen followups RLS so 'management' can view/update the
-- follow-ups they create and assign (they don't own an agent_id
-- queue, but they are created_by on rows they assign). Also adds
-- followup_status_history, an immutable audit log of every status
-- transition on followups, mirroring request_approval_history's
-- exact shape (see supabase/team-leaders-schema.sql section 3).
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — no data changes; RLS policies
-- are dropped/recreated, the new table is additive.
-- ============================================================

-- ─── 1. Widen followups RLS to include management ────────────────────────────

DROP POLICY IF EXISTS "Agents see assigned followups" ON followups;
CREATE POLICY "Agents see assigned followups" ON followups FOR SELECT TO authenticated USING (
  agent_id = auth.uid() OR created_by = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
);

DROP POLICY IF EXISTS "Agents update assigned followups" ON followups;
CREATE POLICY "Agents update assigned followups" ON followups FOR UPDATE TO authenticated USING (
  agent_id = auth.uid() OR created_by = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
);

-- INSERT policy ("Authenticated users can insert followups") only checks
-- created_by = auth.uid() with no role branch — management already
-- satisfies this unmodified; no change needed there.

-- ─── 2. followup_status_history table ─────────────────────────────────────────
-- Immutable audit log, universal (every followup, any creator). No UPDATE
-- or DELETE policies are granted.

CREATE TABLE followup_status_history (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  followup_id  uuid        NOT NULL REFERENCES followups(id) ON DELETE CASCADE,
  changed_by   uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  from_status  text        NOT NULL,
  to_status    text        NOT NULL,
  comment      text,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_followup_status_history_followup_id ON followup_status_history (followup_id);
CREATE INDEX idx_followup_status_history_changed_by ON followup_status_history (changed_by);
CREATE INDEX idx_followup_status_history_changed_at ON followup_status_history (changed_at);

ALTER TABLE followup_status_history ENABLE ROW LEVEL SECURITY;

-- SELECT: anyone who can already see the parent followup can see its history.
CREATE POLICY "followup_status_history_select" ON followup_status_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM followups f
      WHERE f.id = followup_status_history.followup_id
        AND (
          f.agent_id = auth.uid()
          OR f.created_by = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
        )
    )
  );

-- INSERT: unlike request_approval_history (admin-only reviewers write it),
-- followup status transitions are performed by the assigned agent
-- themselves too, not just admin/management — mirrors "Agents update
-- assigned followups" above, plus requires changed_by to match the caller
-- (no writing history on someone else's behalf).
CREATE POLICY "followup_status_history_insert" ON followup_status_history
  FOR INSERT TO authenticated
  WITH CHECK (
    changed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM followups f
      WHERE f.id = followup_status_history.followup_id
        AND (
          f.agent_id = auth.uid()
          OR f.created_by = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
        )
    )
  );
```

No `ALTER TABLE followups` needed — `priority`, `due_date`, `possible_solution`, `resolution_notes` are already nullable, so management's insert simply omits them.

## Types — `types/index.ts` additions

```ts
export interface FollowupStatusHistory {
  id: string
  followup_id: string
  changed_by: string
  from_status: FollowupStatus
  to_status: FollowupStatus
  comment: string | null
  changed_at: string
  profiles?: Pick<Profile, 'full_name'>
}

/** Shared shape for the "Assign to" candidate pool (agents ∪ team leaders) */
export type FollowupAssignee = Pick<Profile, 'id' | 'full_name' | 'email'>
```

## Query layer — `app/(app)/followups/page.tsx`

Three-way role branch replaces the current admin/non-admin filter, plus management's extra candidate pools and the universal status-history fetch. See the implementation plan for the exact code.

## Component design

- **`FollowupManager.tsx`** (modified, additive-only props) — new optional `isManagement`/`agentCandidates`/`teamLeaderCandidates`/`statusHistory` props; hides quick-action buttons for management; wires history writes into the legacy paths; branches which Add/Edit modal renders.
- **`ManagementFollowupModal.tsx`** (new) — Assign to* (combined agents+team-leaders select), Customer* (with inline "+ New Customer" quick-add), Query Description*, Status (edit-only), a static "Assigned {date}" line, and the status-history timeline. No Priority/Possible Solution/Due Date/Resolution Notes.
- **`StatusHistoryTimeline.tsx`** (new) — presentational, renders the transition list for one followup.
- **`lib/followups/insertFollowupHistory.ts`** (new) — shared fire-and-forget helper.

## Files explicitly NOT modified (and why)

- `components/layout/Sidebar.tsx`, `proxy.ts` — Follow-ups is already unconditional for every role.
- `supabase/schema.sql` — no column changes; RLS lives in the new migration file.
- `components/admin/EscalationManager.tsx`, `app/(app)/admin/escalations/page.tsx` — untouched; only the assign+notify *pattern* is reused.
- `components/customers/CustomerManager.tsx` — untouched; the inline quick-add is a small duplicated insert, not a refactor.

## Verification approach

- Live-run the migration; confirm the RLS policy updates and new table/policies apply without error.
- `agent` login: Follow-ups page/modal pixel-for-pixel unchanged.
- `admin` login: unchanged behavior, still sees every followup.
- `management` login: page is no longer empty; can create+assign to an agent or team leader via one combined grouped dropdown; "+ New Customer" actually persists a new customer; none of the four removed fields appear.
- Assignee actually receives a `notifications` row.
- Status changes (by management AND by the assigned agent, proving "universal") produce a `followup_status_history` row and show up in the timeline.
- Reassigning notifies the new agent and the old agent loses visibility (RLS).
