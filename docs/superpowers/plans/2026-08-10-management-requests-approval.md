# Management Approval of Team-Leader Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins (including team leaders) submit their own Leave/Overtime requests from the Roster page, and let `management` approve or reject requests submitted by team leaders specifically, reusing the exact approval mechanics team leaders already use on their agents' requests.

**Architecture:** Two existing self-contained overlay components (`TeamRequestsModal`, the approval view; `RequestsPanel`, the submission view) each get their list/form logic extracted into a "body" component, separate from their overlay/animation/header "chrome." A new `AdminRequestsPanel` combines both bodies behind one two-tab shell for admins. `TeamRequestsModal` itself is reused unmodified for `management`, fed a differently-scoped `requests` list. A new RLS migration widens `requests`/`leave_requests`/`overtime_requests`/`overtime_entries`/`request_approval_history` so `management` can see/update rows whose submitter is a team leader, and a new trigger notifies every `management`-role profile when a team leader submits a request.

**Tech Stack:** Next.js 16 App Router (async Server Components + `'use client'` managers), Supabase Postgres + RLS, TypeScript, Tailwind, `animejs` for panel transitions.

## Global Constraints

- No automated test suite exists in this project (per `CLAUDE.md`) — verification is `npx tsc --noEmit` after every task plus a final manual QA pass (Task 7), consistent with every other feature built this session.
- RLS changes are additive only: every existing OR-branch in every touched policy (`profile_id = auth.uid()`, `is_team_leader_for(team_id)`, `EXISTS(...role = 'admin'...)`) must remain byte-identical; only one new OR-branch is added per policy.
- `is_submitter_team_leader(p_profile_id uuid)` (new) and `is_team_leader_for(p_team_id uuid)` (existing) are different predicates — the former asks "does this profile lead any team," the latter asks "does the current user lead this specific team." Never substitute one for the other.
- Component extraction (Tasks 2–3) must not change any visible behavior, styling, or prop signature of the two existing standalone components (`TeamRequestsModal`, `RequestsPanel`) — this is a pure chrome/content split, verified by manual smoke test as an unaffected role before any new component consumes the extracted pieces.
- New migration file lives in `supabase/migrations/`, follows the established `DROP POLICY IF EXISTS "..."; CREATE POLICY "..."` re-run-safe convention already used by every other migration in that directory.
- The calendar's `pendingLeaveMap` indicator (shown to admins on the Month/Week/Day views) stays admin-only — out of scope for this feature, which only touches the Requests button/panel.

---

### Task 1: RLS migration — management approves team-leader-submitted requests

**Files:**
- Create: `supabase/migrations/management-requests-access.sql`

**Interfaces:**
- Produces: SQL function `is_submitter_team_leader(p_profile_id uuid) RETURNS boolean` — used by later RLS policies and the new trigger function. Widened RLS policies on `requests`, `leave_requests`, `overtime_requests`, `overtime_entries`, `request_approval_history`. New trigger `trg_notify_management_on_team_leader_request` on `requests` (AFTER INSERT).
- Consumes: existing tables/policies from `supabase/requests-schema.sql` and `supabase/team-leaders-schema.sql` (read-only reference, not modified).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/management-requests-access.sql` with this exact content:

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

- [ ] **Step 2: Ask the human to run the migration live**

This project has no migration runner — every `supabase/migrations/*.sql` file is applied by hand in the Supabase SQL Editor (see `CLAUDE.md`). Ask the human partner to paste the file's contents into the Supabase SQL Editor for this project and run it, then confirm it completed with no errors before continuing.

- [ ] **Step 3: Verify the policies and trigger exist**

Ask the human to confirm (via the Supabase Dashboard's Authentication → Policies view, or `\d+ requests` in the SQL Editor) that `requests_select` and `requests_update` on `requests` show the new `is_submitter_team_leader` branch, and that `trg_notify_management_on_team_leader_request` appears in the Dashboard's Database → Triggers view for the `requests` table.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/management-requests-access.sql
git commit -m "feat: let management approve team-leader-submitted requests"
```

---

### Task 2: Extract `TeamRequestsBody` from `TeamRequestsModal`

**Files:**
- Create: `components/roster/admin/TeamRequestsBody.tsx`
- Modify: `components/roster/admin/TeamRequestsModal.tsx`

**Interfaces:**
- Produces: `TeamRequestsBody({ requests: RequestWithDetail[], currentUserId: string, onRefresh: () => void })` — the approval list, tabs, approve/reject actions, and review-drawer trigger. Consumed by Task 4's `AdminRequestsPanel` and by the now-slimmed `TeamRequestsModal`.
- Consumes: `RequestWithDetail`, `RequestStatus` from `@/types` (unchanged); `RequestReviewDrawer` from `@/components/requests/admin/RequestReviewDrawer` (unchanged); `teamColorClasses` from `@/lib/roster/teamColors` (unchanged).
- `TeamRequestsModal`'s own external props (`open`, `onClose`, `requests`, `currentUserId`, `onRefresh`) are unchanged — this is a pure internal refactor, not an interface change.

- [ ] **Step 1: Create `components/roster/admin/TeamRequestsBody.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RequestWithDetail, RequestStatus } from '@/types'
import { teamColorClasses } from '@/lib/roster/teamColors'
import { Calendar, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import RequestReviewDrawer from '@/components/requests/admin/RequestReviewDrawer'

const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: 'Annual',
  sick: 'Sick',
  family_responsibility: 'Family',
  unpaid: 'Unpaid',
  other: 'Other',
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Props {
  requests: RequestWithDetail[]
  currentUserId: string
  onRefresh: () => void
}

type Tab = 'leave' | 'overtime'

export default function TeamRequestsBody({ requests, currentUserId, onRefresh }: Props) {
  const tabContentRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const [activeTab, setActiveTab] = useState<Tab>('leave')
  const [actioning, setActioning] = useState<string | null>(null)
  const [confirmingReject, setConfirmingReject] = useState<string | null>(null)
  const [rejectComment, setRejectComment] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<RequestWithDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!tabContentRef.current) return
    import('animejs').then(({ animate }) => {
      animate(tabContentRef.current!, {
        opacity: [0, 1],
        translateX: [10, 0],
        duration: 180,
        easing: 'easeOutQuad',
      })
    })
  }, [activeTab])

  function handleTabChange(tab: Tab) {
    setActiveTab(tab)
    setConfirmingReject(null)
    setError('')
  }

  const pendingRequests = requests.filter(r => r.status === 'pending' || r.status === 'changes_requested')
  const leaveRequests = pendingRequests.filter(r => r.type === 'leave')
  const overtimeRequests = pendingRequests.filter(r => r.type === 'overtime')
  const displayed = activeTab === 'leave' ? leaveRequests : overtimeRequests

  async function insertApprovalHistory(requestId: string, fromStatus: RequestStatus, toStatus: RequestStatus, comment?: string) {
    const supabase = createClient()
    await supabase.from('request_approval_history').insert({
      request_id: requestId,
      changed_by: currentUserId,
      from_status: fromStatus,
      to_status: toStatus,
      comment: comment || null,
    })
  }

  function animateRowOut(requestId: string, then: () => void) {
    const rowEl = rowRefs.current[requestId]
    if (!rowEl) { then(); return }
    import('animejs').then(({ animate }) => {
      animate(rowEl, {
        opacity: [1, 0],
        translateX: [0, -20],
        duration: 240,
        easing: 'easeInQuad',
        onComplete: then,
      })
    })
  }

  async function handleQuickApprove(req: RequestWithDetail) {
    setActioning(req.id + '_approve')
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('requests')
      .update({
        status: 'approved',
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.id)

    if (err) {
      setActioning(null)
      setError(err.message)
      return
    }

    await insertApprovalHistory(req.id, req.status, 'approved')
    animateRowOut(req.id, () => { setActioning(null); onRefresh() })
  }

  async function handleConfirmReject(req: RequestWithDetail) {
    if (!rejectComment.trim()) {
      setError('A reason is required when rejecting.')
      return
    }
    setActioning(req.id + '_reject')
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('requests')
      .update({
        status: 'rejected',
        admin_comment: rejectComment.trim(),
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.id)

    if (err) {
      setActioning(null)
      setError(err.message)
      return
    }

    await insertApprovalHistory(req.id, req.status, 'rejected', rejectComment.trim())
    animateRowOut(req.id, () => {
      setActioning(null)
      setConfirmingReject(null)
      setRejectComment('')
      onRefresh()
    })
  }

  function openDrawer(req: RequestWithDetail) {
    setSelected(req)
    setDrawerOpen(true)
  }

  const statusMap: Record<RequestStatus, string> = {
    draft:             'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
    pending:           'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    approved:          'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    rejected:          'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    changes_requested: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  }
  const statusLabels: Record<RequestStatus, string> = {
    draft: 'Draft', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', changes_requested: 'Changes Req.',
  }

  return (
    <>
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          {([
            { id: 'leave' as Tab, label: 'Leave', icon: <Calendar className="w-3.5 h-3.5" />, count: leaveRequests.length },
            { id: 'overtime' as Tab, label: 'Overtime', icon: <Clock className="w-3.5 h-3.5" />, count: overtimeRequests.length },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ml-0.5 ${
                  activeTab === tab.id
                    ? 'bg-white/20 text-white'
                    : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto" ref={tabContentRef}>
        {error && (
          <div className="mx-6 mt-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {displayed.length === 0 ? (
          <div className="py-16 text-center px-6">
            {activeTab === 'leave'
              ? <Calendar className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              : <Clock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            }
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No {activeTab === 'leave' ? 'leave' : 'overtime'} requests pending.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {displayed.map(req => {
              const teamColors = req.teams ? teamColorClasses[req.teams.color] : null
              const initials = (req.profiles?.full_name ?? '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
              const leaveDetail = req.leave_requests?.[0]
              const otDetail = req.overtime_requests?.[0]
              const isConfirmingReject = confirmingReject === req.id
              const isActioning = actioning?.startsWith(req.id)

              return (
                <div
                  key={req.id}
                  ref={el => { rowRefs.current[req.id] = el }}
                  className="flex flex-col px-6 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 ${teamColors ? teamColors.bg : 'bg-gray-400'}`}>
                      {initials}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {req.profiles?.full_name ?? 'Unknown'}
                        </p>
                        {req.teams && (
                          <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${teamColors?.lightBg} ${teamColors?.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${teamColors?.dot}`} />
                            {req.teams.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {leaveDetail
                            ? `${LEAVE_TYPE_LABELS[leaveDetail.leave_type] ?? leaveDetail.leave_type} · ${leaveDetail.dates.length} day${leaveDetail.dates.length !== 1 ? 's' : ''}`
                            : otDetail
                              ? `${MONTH_NAMES[otDetail.month - 1]} ${otDetail.year}`
                              : ''}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(req.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMap[req.status]}`}>
                        {statusLabels[req.status]}
                      </span>

                      <button
                        onClick={() => handleQuickApprove(req)}
                        disabled={!!actioning}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:bg-green-400 rounded-lg transition-colors"
                      >
                        {actioning === req.id + '_approve'
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <CheckCircle className="w-3 h-3" />}
                        Approve
                      </button>

                      <button
                        onClick={() => {
                          setConfirmingReject(isConfirmingReject ? null : req.id)
                          setRejectComment('')
                          setError('')
                        }}
                        disabled={!!actioning}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-lg transition-colors"
                      >
                        {actioning === req.id + '_reject'
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <XCircle className="w-3 h-3" />}
                        Reject
                      </button>

                      <button
                        onClick={() => openDrawer(req)}
                        className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        Details
                      </button>
                    </div>
                  </div>

                  {isConfirmingReject && (
                    <div className="w-full mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Reason for rejection (required)..."
                          value={rejectComment}
                          onChange={e => setRejectComment(e.target.value)}
                          className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
                        />
                        <button
                          onClick={() => handleConfirmReject(req)}
                          disabled={isActioning || !rejectComment.trim()}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-lg transition-colors shrink-0"
                        >
                          {isActioning ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm Reject'}
                        </button>
                        <button
                          onClick={() => { setConfirmingReject(null); setRejectComment(''); setError('') }}
                          className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <RequestReviewDrawer
        request={selected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSuccess={() => { setDrawerOpen(false); onRefresh() }}
        currentUserId={currentUserId}
      />
    </>
  )
}
```

- [ ] **Step 2: Replace `components/roster/admin/TeamRequestsModal.tsx` with the slimmed chrome-only version**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { RequestWithDetail } from '@/types'
import { Inbox, X } from 'lucide-react'
import TeamRequestsBody from './TeamRequestsBody'

interface Props {
  open: boolean
  onClose: () => void
  requests: RequestWithDetail[]
  currentUserId: string
  onRefresh: () => void
}

export default function TeamRequestsModal({ open, onClose, requests, currentUserId, onRefresh }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !panelRef.current) return
    import('animejs').then(({ animate }) => {
      animate(panelRef.current!, {
        scale: [0.97, 1],
        opacity: [0, 1],
        duration: 260,
        easing: 'easeOutQuart',
      })
      if (overlayRef.current) {
        animate(overlayRef.current, { opacity: [0, 1], duration: 200, easing: 'easeOutQuad' })
      }
    })
  }, [open])

  function handleClose() {
    if (!panelRef.current) { onClose(); return }
    import('animejs').then(({ animate }) => {
      animate(panelRef.current!, {
        scale: [1, 0.97],
        opacity: [1, 0],
        duration: 180,
        easing: 'easeInQuad',
        onComplete: () => onClose(),
      })
      if (overlayRef.current) {
        animate(overlayRef.current, { opacity: [1, 0], duration: 160, easing: 'easeInQuad' })
      }
    })
  }

  if (!open) return null

  const pendingCount = requests.filter(r => r.status === 'pending' || r.status === 'changes_requested').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        ref={overlayRef}
        style={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
      />

      <div
        ref={panelRef}
        style={{ opacity: 0 }}
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Team Requests</h2>
            {pendingCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                {pendingCount} pending
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <TeamRequestsBody requests={requests} currentUserId={currentUserId} onRefresh={onRefresh} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Manual smoke test**

Start the dev server (`npm run dev`), log in as `admin`, open Roster → Requests. Confirm the modal still opens with the same animation, shows the same pending list, and Approve/Reject/Details all still work exactly as before this refactor (no behavior should have changed — this step is purely to confirm the split didn't break anything).

- [ ] **Step 5: Commit**

```bash
git add components/roster/admin/TeamRequestsBody.tsx components/roster/admin/TeamRequestsModal.tsx
git commit -m "refactor: split TeamRequestsModal into chrome + TeamRequestsBody"
```

---

### Task 3: Extract `MyRequestsBody` from `RequestsPanel`

**Files:**
- Create: `components/requests/MyRequestsBody.tsx`
- Modify: `components/requests/RequestsPanel.tsx`

**Interfaces:**
- Produces: `MyRequestsBody({ profile: Profile, userTeam: Team | null, onSuccess: () => void })` — the Leave/Overtime sub-tab switcher and the two submission forms. Consumed by Task 4's `AdminRequestsPanel` and by the now-slimmed `RequestsPanel`.
- Consumes: `LeaveRequestForm`, `OvertimeRequestForm` from the same directory (both take `{ profile, userTeam, onSuccess }` — unchanged, confirmed by direct read of both files).
- `RequestsPanel`'s own external props (`open`, `onClose`, `onSuccess`, `profile`, `userTeam`, `isAdmin`, `myRequests`) are unchanged — this is a pure internal refactor. `isAdmin`/`myRequests` stay declared in its `Props` interface but unused in the function body (they were already unused before this refactor — not this task's concern to remove them).

- [ ] **Step 1: Create `components/requests/MyRequestsBody.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Profile, Team } from '@/types'
import LeaveRequestForm from './LeaveRequestForm'
import OvertimeRequestForm from './OvertimeRequestForm'

type RequestTab = 'leave' | 'overtime'

interface Props {
  profile: Profile
  userTeam: Team | null
  onSuccess: () => void
}

export default function MyRequestsBody({ profile, userTeam, onSuccess }: Props) {
  const [tab, setTab] = useState<RequestTab>('leave')
  const [tabKey, setTabKey] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  function handleTabChange(t: RequestTab) {
    if (t === tab) return
    setTab(t)
    setTabKey(k => k + 1)
  }

  useEffect(() => {
    if (!contentRef.current) return
    import('animejs').then(({ animate }) => {
      animate(contentRef.current!, {
        opacity: [0, 1],
        translateX: [10, 0],
        duration: 180,
        easing: 'easeOutQuad',
      })
    })
  }, [tabKey])

  return (
    <>
      <div className="flex items-center gap-1 px-5 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center border border-gray-700 rounded-lg overflow-hidden">
          {(['leave', 'overtime'] as RequestTab[]).map(t => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {t === 'leave' ? 'Leave Request' : 'Overtime Request'}
            </button>
          ))}
        </div>
      </div>

      <div ref={contentRef} key={tabKey} className="flex-1 overflow-y-auto">
        {tab === 'leave' ? (
          <LeaveRequestForm profile={profile} userTeam={userTeam} onSuccess={onSuccess} />
        ) : (
          <OvertimeRequestForm profile={profile} userTeam={userTeam} onSuccess={onSuccess} />
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Replace `components/requests/RequestsPanel.tsx` with the slimmed chrome-only version**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Profile, Team, RequestWithDetail } from '@/types'
import MyRequestsBody from './MyRequestsBody'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  profile: Profile
  userTeam: Team | null
  isAdmin: boolean
  myRequests: RequestWithDetail[]
}

export default function RequestsPanel({ open, onClose, onSuccess, profile, userTeam }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !panelRef.current) return
    import('animejs').then(({ animate }) => {
      animate(panelRef.current!, {
        translateX: [60, 0],
        opacity: [0, 1],
        duration: 280,
        easing: 'easeOutQuart',
      })
      if (overlayRef.current) {
        animate(overlayRef.current, {
          opacity: [0, 1],
          duration: 200,
          easing: 'easeOutQuad',
        })
      }
    })
  }, [open])

  function handleClose() {
    if (!panelRef.current || !overlayRef.current) { onClose(); return }
    import('animejs').then(({ animate }) => {
      animate(panelRef.current!, {
        translateX: [0, 60],
        opacity: [1, 0],
        duration: 200,
        easing: 'easeInQuad',
        onComplete: () => onClose(),
      })
      animate(overlayRef.current!, {
        opacity: [1, 0],
        duration: 180,
        easing: 'easeInQuad',
      })
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/40"
        style={{ opacity: 0 }}
        onClick={handleClose}
      />

      <div
        ref={panelRef}
        style={{ opacity: 0 }}
        className="relative w-full sm:w-[480px] h-full bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-base font-semibold text-white">Submit a Request</h2>
          <button
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            aria-label="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <MyRequestsBody profile={profile} userTeam={userTeam} onSuccess={() => { onSuccess(); handleClose() }} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Manual smoke test**

Log in as `agent`, open Roster → Requests, submit a Leave request. Confirm the slide-in panel, tab switcher, and form all behave exactly as before this refactor, and the panel closes on success.

- [ ] **Step 5: Commit**

```bash
git add components/requests/MyRequestsBody.tsx components/requests/RequestsPanel.tsx
git commit -m "refactor: split RequestsPanel into chrome + MyRequestsBody"
```

---

### Task 4: New `AdminRequestsPanel` — combined My Requests / Team Requests tabs

**Files:**
- Create: `components/roster/admin/AdminRequestsPanel.tsx`

**Interfaces:**
- Consumes: `MyRequestsBody` (Task 3) — `{ profile, userTeam, onSuccess }`. `TeamRequestsBody` (Task 2) — `{ requests, currentUserId, onRefresh }`.
- Produces: `AdminRequestsPanel({ open: boolean, onClose: () => void, profile: Profile, userTeam: Team | null, requests: RequestWithDetail[], currentUserId: string, onRefresh: () => void })` — consumed by Task 6's `RosterManager.tsx`.

- [ ] **Step 1: Create `components/roster/admin/AdminRequestsPanel.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Profile, Team, RequestWithDetail } from '@/types'
import { Inbox, X, User, Users2 } from 'lucide-react'
import MyRequestsBody from '@/components/requests/MyRequestsBody'
import TeamRequestsBody from './TeamRequestsBody'

type HubTab = 'mine' | 'team'

interface Props {
  open: boolean
  onClose: () => void
  profile: Profile
  userTeam: Team | null
  requests: RequestWithDetail[]
  currentUserId: string
  onRefresh: () => void
}

export default function AdminRequestsPanel({ open, onClose, profile, userTeam, requests, currentUserId, onRefresh }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<HubTab>('team')

  useEffect(() => {
    if (!open || !panelRef.current) return
    import('animejs').then(({ animate }) => {
      animate(panelRef.current!, {
        scale: [0.97, 1],
        opacity: [0, 1],
        duration: 260,
        easing: 'easeOutQuart',
      })
      if (overlayRef.current) {
        animate(overlayRef.current, { opacity: [0, 1], duration: 200, easing: 'easeOutQuad' })
      }
    })
  }, [open])

  function handleClose() {
    if (!panelRef.current) { onClose(); return }
    import('animejs').then(({ animate }) => {
      animate(panelRef.current!, {
        scale: [1, 0.97],
        opacity: [1, 0],
        duration: 180,
        easing: 'easeInQuad',
        onComplete: () => onClose(),
      })
      if (overlayRef.current) {
        animate(overlayRef.current, { opacity: [1, 0], duration: 160, easing: 'easeInQuad' })
      }
    })
  }

  if (!open) return null

  const pendingCount = requests.filter(r => r.status === 'pending' || r.status === 'changes_requested').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        ref={overlayRef}
        style={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
      />

      <div
        ref={panelRef}
        style={{ opacity: 0 }}
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Requests</h2>
            {tab === 'team' && pendingCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                {pendingCount} pending
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-6 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setTab('mine')}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === 'mine'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5" /> My Requests
            </button>
            <button
              onClick={() => setTab('team')}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === 'team'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Users2 className="w-3.5 h-3.5" /> Team Requests
              {pendingCount > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ml-0.5 ${
                  tab === 'team' ? 'bg-white/20 text-white' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                }`}>
                  {pendingCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {tab === 'mine' ? (
          <MyRequestsBody profile={profile} userTeam={userTeam} onSuccess={() => { onRefresh(); handleClose() }} />
        ) : (
          <TeamRequestsBody requests={requests} currentUserId={currentUserId} onRefresh={onRefresh} />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors. (This component isn't wired into `RosterManager` yet — Task 6 does that — so there's no in-browser check here beyond compiling.)

- [ ] **Step 3: Commit**

```bash
git add components/roster/admin/AdminRequestsPanel.tsx
git commit -m "feat: add AdminRequestsPanel with My Requests / Team Requests tabs"
```

---

### Task 5: Page query wiring — `app/(app)/roster/page.tsx`

**Files:**
- Modify: `app/(app)/roster/page.tsx`

**Interfaces:**
- Consumes: `is_submitter_team_leader` indirectly via RLS (Task 1) — the query itself just filters by `profile_id IN (...)`, RLS enforces the real boundary.
- Produces: `RosterPageData.pendingRequests` now populated for `management` too (previously always `[]` for that role). No change to the `RosterPageData` type itself — `pendingRequests` was already optional and typed `RequestWithDetail[]`.

- [ ] **Step 1: Replace `app/(app)/roster/page.tsx` with the updated query wiring**

```tsx
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { redirect } from 'next/navigation'
import Header from '@/components/layout/Header'
import RosterManager from '@/components/roster/RosterManager'
import { getRosterFetchRange } from '@/lib/roster/calendarUtils'
import { Team, TeamMember, RosterPageData, RequestWithDetail } from '@/types'

export default async function RosterPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  if (!userId) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, department, avatar_url, is_active, force_password_change, created_at, updated_at')
    .eq('id', userId)
    .single()

  if (!profile) redirect('/login')

  const isAdmin = profile.role === 'admin'
  const isManagement = profile.role === 'management'

  const now = new Date()
  const { from, to } = getRosterFetchRange(now.getFullYear(), now.getMonth())

  const requestDetailSelect = `
    *,
    profiles!requests_profile_id_fkey(id, full_name, email),
    teams(id, name, color),
    leave_requests(*),
    overtime_requests(*, overtime_entries(*))
  `

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
    supabase
      .from('teams')
      .select('*, team_members(id, team_id, profile_id, joined_at, profiles(id, full_name, email, is_active))')
      .order('name'),
    supabase
      .from('profiles')
      .select('id, full_name, email, is_active')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('shift_templates')
      .select('*')
      .order('name'),
    supabase
      .from('team_rotations')
      .select('*, teams(id, name, color), shift_templates(id, name, start_time, end_time, work_days)')
      .gte('week_start_date', from)
      .lte('week_start_date', to),
    supabase
      .from('attendance_records')
      .select('*')
      .gte('date', from)
      .lte('date', to),
    supabase
      .from('roster_overrides')
      .select('*, shift_templates(id, name, start_time, end_time)')
      .gte('date', from)
      .lte('date', to),
    // Current user's own requests
    supabase
      .from('requests')
      .select(requestDetailSelect)
      .eq('profile_id', userId)
      .order('created_at', { ascending: false }),
    // Team leader team IDs for the current admin (empty for agents/management)
    isAdmin
      ? supabase.from('team_leaders').select('team_id').eq('profile_id', userId)
      : Promise.resolve({ data: [] }),
  ])

  // Pending requests: admin sees all; management sees only requests
  // submitted by a team leader; agent gets none (RLS returns empty either
  // way, but skipping the query avoids an unnecessary round trip).
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
    const teamLeaderProfileIds = [...new Set((teamLeaderProfileRows ?? []).map((r: { profile_id: string }) => r.profile_id))]
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

  // Derive the current user's team from the team_members data
  const flatMembers: TeamMember[] = (teams ?? []).flatMap((t: Team & { team_members: TeamMember[] }) => t.team_members ?? [])
  const myMembership = flatMembers.find(m => m.profile_id === userId)
  const userTeam = myMembership
    ? (teams ?? []).find((t: Team & { team_members: TeamMember[] }) => t.id === myMembership.team_id) ?? null
    : null

  const teamLeaderTeamIds = (teamLeaderRows ?? []).map((r: { team_id: string }) => r.team_id)

  const pageData: RosterPageData = {
    profile,
    teams: (teams ?? []) as (Team & { team_members: TeamMember[] })[],
    allProfiles: allProfiles ?? [],
    shiftTemplates: shiftTemplates ?? [],
    rotations: rotations ?? [],
    attendanceRecords: attendanceRecords ?? [],
    overrides: overrides ?? [],
    userTeam,
    myRequests: (myRequests ?? []) as RequestWithDetail[],
    pendingRequests,
    teamLeaderTeamIds,
  }

  return (
    <div className="flex-1 overflow-auto">
      <Header title="Team Roster" userId={profile.id} userRole={profile.role} />
      <div className="p-6 space-y-5">
        <RosterManager data={pageData} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Manual regression check**

Log in as `admin`, open Roster. Confirm the page loads and the Requests button/badge behave exactly as before (this task only changes how `pendingRequests` is computed server-side — `RosterManager` doesn't consume it any differently until Task 6, so this is a pure regression check, not a new-behavior check).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/roster/page.tsx"
git commit -m "feat: fetch team-leader-scoped pending requests for management"
```

---

### Task 6: Wire the three-way branch into `RosterManager.tsx`

**Files:**
- Modify: `components/roster/RosterManager.tsx`

**Interfaces:**
- Consumes: `AdminRequestsPanel` (Task 4), `TeamRequestsModal` (Task 2, unchanged external props), `RequestsPanel` (Task 3, unchanged external props).

- [ ] **Step 1: Add the `AdminRequestsPanel` import and the `isManagement` flag**

In `components/roster/RosterManager.tsx`, add this import alongside the existing `TeamRequestsModal` import:

```tsx
import AdminRequestsPanel from './admin/AdminRequestsPanel'
```

Change:

```tsx
  const isAdmin = profile.role === 'admin'
  const isTeamLeader = teamLeaderTeamIds.length > 0
```

to:

```tsx
  const isAdmin = profile.role === 'admin'
  const isManagement = profile.role === 'management'
  const isTeamLeader = teamLeaderTeamIds.length > 0
```

- [ ] **Step 2: Extend the pending-count badge to management**

Change:

```tsx
          {isAdmin && pendingCount > 0 && (
```

to:

```tsx
          {(isAdmin || isManagement) && pendingCount > 0 && (
```

- [ ] **Step 3: Replace the two-way modal branch with the three-way branch**

Change:

```tsx
      {/* Admin: Team Requests Management Modal | Agent: Request submission panel */}
      {isAdmin ? (
        <TeamRequestsModal
          open={requestsPanelOpen}
          onClose={() => setRequestsPanelOpen(false)}
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

to:

```tsx
      {/* Management: approve team-leader requests | Admin: My Requests + Team Requests tabs | Agent: submission panel */}
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

Note: `scopedPendingRequests`'s existing `useMemo` (`if (!isAdmin || !pendingRequests) return pendingRequests ?? []`) needs NO code change — its `!isAdmin` branch already returns `pendingRequests` straight through for any non-admin role, which is exactly correct for management (whose `pendingRequests` is now server-scoped to team-leader submissions per Task 5, and needs no further client-side filtering).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Manual verification — all three roles**

Using the minted-session technique (see `mint-session.mjs` pattern used throughout this project's session — or real logins if simpler) or the seeded dev accounts:

- As `agent`: Roster → Requests still opens the plain submission panel, unchanged.
- As a plain `admin` (no `team_leaders` row): Roster → Requests now opens the two-tab `AdminRequestsPanel`. "Team Requests" tab shows the same unscoped pending list as before. "My Requests" tab submits a Leave request successfully; confirm the panel closes and the new request appears in `requests` with `profile_id` = this admin.
- As an `admin` who **is** a team leader: same two-tab panel; "Team Requests" tab still shows only their team's agents' pending requests (unchanged scoping); submit via "My Requests" and confirm the new row has `team_id = null`.
- As `management`: Roster → Requests now opens the approval view (`TeamRequestsModal`), showing only the team-leader-submitted request from the previous step (not the plain admin's request from the step before it). Approve it; confirm `reviewed_by`/`reviewed_at` are set and the pending badge count decreases.

- [ ] **Step 6: Commit**

```bash
git add components/roster/RosterManager.tsx
git commit -m "feat: route Roster Requests button per role (management/admin/agent)"
```

---

### Task 7: Full manual QA pass

**Files:** none (verification only).

- [ ] **Step 1: RLS boundary check via minted sessions**

Using the same mint-session + `/api/auth/supabase-token` technique used throughout this project's earlier sessions, confirm directly against PostgREST (not just through the UI):

- A team leader's own submitted request is readable/updatable by: themselves, any `admin`-role profile, and any `management`-role profile. NOT readable/updatable by an unrelated agent.
- A plain (non-team-leading) admin's own submitted request is readable/updatable by: themselves and any `admin`-role profile. NOT readable/updatable by `management` (confirm a management session gets an empty/blocked result attempting to see or update it).
- `request_approval_history` INSERT succeeds for `management` approving a team-leader-submitted request, and fails for `management` attempting to insert history against a plain-admin-submitted request.

- [ ] **Step 2: Notification check**

Submit a request as a team leader; confirm every `management`-role profile in the database receives a `notifications` row (query `notifications` directly with a service-role or admin session, filtered by `type = 'request'` and the new `request_id`).

- [ ] **Step 3: End-to-end UI pass**

Repeat Task 6 Step 5's manual verification once more end-to-end in a real browser (not minted-session curl) to confirm the actual rendered UI — tab switching, animations, badge counts, approve/reject buttons — all work together as a cohesive flow, not just as individually-passing pieces.

- [ ] **Step 4: Clean up test data**

Delete every request/notification/approval-history row created during this QA pass (via a service-role query or the Supabase Dashboard table editor), and confirm they're gone.

No commit for this task — it's verification only. If any step surfaces a real bug, fix it as a normal follow-up commit on this branch before calling the plan complete.
