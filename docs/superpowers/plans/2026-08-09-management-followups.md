# Management-Assigned Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `management`-role users create and assign follow-ups to agents or team leaders (rather than working customers personally), with a reduced field set and a universal status-change history timeline that doesn't exist anywhere in this table today.

**Architecture:** Widen `followups` RLS to include `management` (read/update) and add a new `followup_status_history` audit table, both via one migration. Extend `FollowupManager.tsx` with optional, safe-defaulted props (`isManagement`, `agentCandidates`, `teamLeaderCandidates`, `statusHistory`) so agent/admin behavior is provably unchanged. Fork the Add/Edit modal into a new `ManagementFollowupModal.tsx` for the management path only, reusing the existing insert→notify pattern from `EscalationManager`. Status-history rows are written via a small shared app-level helper (matching the real `request_approval_history` precedent — a plain `.insert()` call, not a DB trigger), from every status-changing code path in the feature, not just management's.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), Tailwind, `lucide-react`, `date-fns`. No new dependencies.

## Global Constraints

- No automated test suite exists in this project (confirmed in `CLAUDE.md`) — every task's "verify" step is a manual/live check.
- Every new prop added to `FollowupManager.tsx` must be **optional** with a safe default (`false`/`[]`), so `app/(app)/followups/page.tsx`'s call site for `agent`/`admin` sessions needs no behavior change and the existing modal/quick-actions stay pixel-for-pixel identical for those roles.
- Status-history writes are **universal** — every status-changing code path in this feature (the legacy `updateStatus`/`handleSave` in `FollowupManager.tsx`, and the new `ManagementFollowupModal.tsx`) calls the same shared helper. Do not gate this by role.
- The history-write helper is a **plain app-level `.insert()`, fire-and-forget, no error surfaced** — this matches the verified real precedent (`insertApprovalHistory` in `TeamRequestsModal.tsx`), not a DB trigger. Do not add trigger-based logging.
- `components/admin/EscalationManager.tsx`, `app/(app)/admin/escalations/page.tsx`, `components/customers/CustomerManager.tsx`, `components/layout/Sidebar.tsx`, and `proxy.ts` are NOT modified by this plan. Only the assign+notify *pattern* from Escalations is reused (transcribed), not its code.
- `team_leaders` has two FKs to `profiles` (`profile_id`, `assigned_by`) — any PostgREST embed of `profiles` through `team_leaders` MUST be qualified as `profiles!team_leaders_profile_id_fkey(...)` or PostgREST returns an error instead of rows.
- All `profiles(...)` selects/embeds MUST use explicit column lists — never `select('*')`.
- The manual "Due Date" field, "Priority" field, "Possible Solution" field, and "Resolution Notes" field are REMOVED from `ManagementFollowupModal.tsx` only — the legacy modal (agent/admin) keeps all four exactly as today.

---

### Task 1: RLS migration — widen followups, add status history table

**Files:**
- Create: `supabase/migrations/management-followups-access.sql`

**Interfaces:**
- Consumes: nothing new.
- Produces: after this task, a `management`-role session can SELECT/UPDATE any `followups` row where they are `created_by` (already could insert, per the unmodified INSERT policy) — plus a new `followup_status_history` table exists, readable/writable by anyone who can already read/update the parent followup.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/management-followups-access.sql`:

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

- [ ] **Step 2: Run it live**

Run this file's contents in the Supabase SQL Editor.

- [ ] **Step 3: Verify live**

Using minted JWTs (or sessions) for each role: confirm a `management` session can now SELECT/UPDATE a `followups` row where they are `created_by`. Confirm an `agent` session's existing access (own `agent_id`/`created_by` rows) is unaffected. Insert a test row into `followup_status_history` as the `created_by` of a followup and confirm it succeeds; confirm an unrelated `agent` session cannot insert a history row for a followup they have no relationship to. Clean up any test data afterward.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/management-followups-access.sql
git commit -m "feat: widen followups RLS for management, add followup_status_history table"
```

---

### Task 2: Types

**Files:**
- Modify: `types/index.ts`

**Interfaces:**
- Consumes: existing `FollowupStatus`, `Profile` types.
- Produces: `FollowupStatusHistory`, `FollowupAssignee` — consumed by Tasks 3-7.

- [ ] **Step 1: Add the two new types**

In `types/index.ts`, add near the existing `Followup`/`RequestApprovalHistory` block:

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

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit` — expect no errors (these types aren't consumed yet, purely additive).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add FollowupStatusHistory and FollowupAssignee types"
```

---

### Task 3: Shared history-write helper

**Files:**
- Create: `lib/followups/insertFollowupHistory.ts`

**Interfaces:**
- Consumes: `FollowupStatus` from `@/types`; `createClient` from `@/lib/supabase/client` (type reference only, for the parameter type).
- Produces: `insertFollowupHistory(supabase, followupId, changedBy, fromStatus, toStatus): Promise<void>` — consumed by Task 6 (`FollowupManager.tsx`) and Task 7 (`ManagementFollowupModal.tsx`).

- [ ] **Step 1: Create the helper**

Create `lib/followups/insertFollowupHistory.ts`:

```ts
import { createClient } from '@/lib/supabase/client'
import { FollowupStatus } from '@/types'

export async function insertFollowupHistory(
  supabase: ReturnType<typeof createClient>,
  followupId: string,
  changedBy: string,
  fromStatus: FollowupStatus,
  toStatus: FollowupStatus,
) {
  await supabase.from('followup_status_history').insert({
    followup_id: followupId,
    changed_by: changedBy,
    from_status: fromStatus,
    to_status: toStatus,
  })
}
```

Fire-and-forget, matching `insertApprovalHistory`'s own lack of error handling in `TeamRequestsModal.tsx` — not an oversight, a deliberate match to the verified precedent.

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit` — expect no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/followups/insertFollowupHistory.ts
git commit -m "feat: add shared insertFollowupHistory helper"
```

---

### Task 4: `StatusHistoryTimeline` display component

**Files:**
- Create: `components/followups/StatusHistoryTimeline.tsx`

**Interfaces:**
- Consumes: `FollowupStatusHistory` from `@/types`.
- Produces: `StatusHistoryTimeline` — default export, props `{ items: FollowupStatusHistory[] }`. Consumed by Task 6 (legacy modal) and Task 7 (`ManagementFollowupModal.tsx`).

- [ ] **Step 1: Create the component**

Create `components/followups/StatusHistoryTimeline.tsx`:

```tsx
'use client'

import { FollowupStatusHistory } from '@/types'
import { format } from 'date-fns'

interface Props {
  items: FollowupStatusHistory[]
}

const statusLabel: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

const statusBadge: Record<string, string> = {
  open: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
  in_progress: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
  resolved: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
  closed: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
}

export default function StatusHistoryTimeline({ items }: Props) {
  if (items.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500">No status changes yet.</p>
  }

  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 text-xs">
          <span className={`px-1.5 py-0.5 rounded font-medium ${statusBadge[item.from_status]}`}>{statusLabel[item.from_status]}</span>
          <span className="text-gray-400">→</span>
          <span className={`px-1.5 py-0.5 rounded font-medium ${statusBadge[item.to_status]}`}>{statusLabel[item.to_status]}</span>
          <span className="text-gray-400 dark:text-gray-500">
            {item.profiles?.full_name ? `by ${item.profiles.full_name}, ` : ''}
            {format(new Date(item.changed_at), 'dd MMM yyyy HH:mm')}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors. Not wired into any page yet, so no visual check is possible until Task 6.

- [ ] **Step 3: Commit**

```bash
git add components/followups/StatusHistoryTimeline.tsx
git commit -m "feat: add StatusHistoryTimeline component"
```

---

### Task 5: Wire the page query

**Files:**
- Modify: `app/(app)/followups/page.tsx`

**Interfaces:**
- Consumes: `FollowupStatusHistory`, `FollowupAssignee` from `@/types` (Task 2).
- Produces: `FollowupManager` is called with 4 new props (`isManagement`, `agentCandidates`, `teamLeaderCandidates`, `statusHistory`) that don't exist on `FollowupManager` yet — Task 6 adds them. This is expected to leave a type-check error until Task 6 lands.

- [ ] **Step 1: Read the current file**

Read `app/(app)/followups/page.tsx` in full before editing — it's a short file (~34 lines) and this task replaces most of its body.

- [ ] **Step 2: Replace the query logic**

Replace the body of the exported page function (keep the existing imports and the outer function signature) with:

```ts
export default async function FollowupsPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId!).single()

  const isManagement = profile?.role === 'management'
  const isAdmin = profile?.role === 'admin'

  const followupQuery = supabase
    .from('followups')
    .select('*, customers(name, phone), profiles!followups_agent_id_fkey(full_name), creator:profiles!followups_created_by_fkey(full_name)')
    .order('created_at', { ascending: false })

  if (isManagement) {
    followupQuery.eq('created_by', userId!)   // what they created/assigned
  } else if (!isAdmin) {
    followupQuery.eq('agent_id', userId!)     // unchanged agent behavior
  }
  // admin: no filter, unchanged

  const [{ data: followups }, { data: customers }] = await Promise.all([
    followupQuery,
    supabase.from('customers').select('id, name, phone').order('name', { ascending: true }),
  ])

  const ids = (followups || []).map(f => f.id)
  const { data: statusHistory } = ids.length
    ? await supabase.from('followup_status_history').select('*, profiles(full_name)').in('followup_id', ids).order('changed_at', { ascending: true })
    : { data: [] as FollowupStatusHistory[] }

  let agentCandidates: FollowupAssignee[] = []
  let teamLeaderCandidates: { profile_id: string; profiles: (FollowupAssignee & { is_active: boolean }) | null }[] = []

  if (isManagement) {
    const [{ data: agents }, { data: leaders }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').eq('role', 'agent').eq('is_active', true).order('full_name'),
      // team_leaders has two FKs to profiles (profile_id, assigned_by) — the
      // embed must be qualified or PostgREST errors instead of returning rows
      // (established convention, see app/(app)/coaching/page.tsx).
      supabase.from('team_leaders').select('profile_id, profiles!team_leaders_profile_id_fkey(id, full_name, email, is_active)'),
    ])
    agentCandidates = agents || []
    teamLeaderCandidates = leaders || []
  }

  return (
    <div>
      <Header title="Follow-ups & Escalations" userId={userId!} userRole={profile?.role} />
      <div className="p-6">
        <FollowupManager
          followups={followups || []}
          customers={customers || []}
          userId={userId!}
          isAdmin={isAdmin}
          isManagement={isManagement}
          agentCandidates={agentCandidates}
          teamLeaderCandidates={teamLeaderCandidates}
          statusHistory={statusHistory || []}
        />
      </div>
    </div>
  )
}
```

Add the import for the two new types at the top of the file, alongside the existing imports:
```ts
import { FollowupStatusHistory, FollowupAssignee } from '@/types'
```

The `<Header title="Follow-ups & Escalations" .../>` call is unchanged from today — only the data passed to `FollowupManager` is new.

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit`. Expect errors on the `<FollowupManager ... />` call — specifically that `isManagement`, `agentCandidates`, `teamLeaderCandidates`, and `statusHistory` don't exist on `FollowupManager`'s props type. This is expected and resolved by Task 6, which adds these props to `FollowupManager.tsx`. No other errors should appear (e.g. no errors about `FollowupStatusHistory`/`FollowupAssignee` not existing — those were added in Task 2).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/followups/page.tsx"
git commit -m "feat: fetch management candidate pools and universal status history for followups"
```

---

### Task 6: Extend `FollowupManager.tsx`

**Files:**
- Modify: `components/followups/FollowupManager.tsx`

**Interfaces:**
- Consumes: `insertFollowupHistory` (Task 3), `StatusHistoryTimeline` (Task 4), `FollowupStatusHistory`/`FollowupAssignee` (Task 2). Also imports `ManagementFollowupModal` from `./ManagementFollowupModal` — this component does not exist yet (Task 7 creates it), so this task is expected to leave ONE compile error until Task 7 lands.
- Produces: `FollowupManager` accepts 4 new optional props (`isManagement?: boolean` default `false`, `agentCandidates?: FollowupAssignee[]` default `[]`, `teamLeaderCandidates?: {...}[]` default `[]`, `statusHistory?: FollowupStatusHistory[]` default `[]`). This resolves Task 5's expected error.

- [ ] **Step 1: Replace the full file**

Replace the full contents of `components/followups/FollowupManager.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import { Followup, Priority, FollowupStatus, FollowupStatusHistory, FollowupAssignee } from '@/types'
import { Plus, FileText, AlertTriangle, Clock, CheckCircle } from 'lucide-react'
import { format } from 'date-fns'
import { insertFollowupHistory } from '@/lib/followups/insertFollowupHistory'
import StatusHistoryTimeline from './StatusHistoryTimeline'
import ManagementFollowupModal from './ManagementFollowupModal'

interface Props {
  followups: (Followup & { customers: { name: string; phone: string } | null; profiles: { full_name: string } | null; creator: { full_name: string } | null })[]
  customers: { id: string; name: string; phone: string }[]
  userId: string
  isAdmin: boolean
  isManagement?: boolean
  agentCandidates?: FollowupAssignee[]
  teamLeaderCandidates?: { profile_id: string; profiles: (FollowupAssignee & { is_active: boolean }) | null }[]
  statusHistory?: FollowupStatusHistory[]
}

const priorityBadge = {
  low:    'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  normal: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
  high:   'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400',
  urgent: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
}

const statusBadge = {
  open:        'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
  in_progress: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
  resolved:    'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
  closed:      'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
}

const empty: { customer_id: string; query_description: string; possible_solution: string; priority: Priority; due_date: string; notes: string; status: FollowupStatus } = {
  customer_id: '', query_description: '', possible_solution: '', priority: 'normal',
  due_date: '', notes: '', status: 'open',
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function FollowupManager({
  followups, customers, userId, isAdmin,
  isManagement = false, agentCandidates = [], teamLeaderCandidates = [], statusHistory = [],
}: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Followup | null>(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const historyByFollowup = useMemo(() => {
    const map: Record<string, FollowupStatusHistory[]> = {}
    for (const item of statusHistory) {
      if (!map[item.followup_id]) map[item.followup_id] = []
      map[item.followup_id].push(item)
    }
    return map
  }, [statusHistory])

  const filtered = followups.filter(f => {
    const statusMatch = filter === 'all' || f.status === filter
    const typeMatch = typeFilter === 'all' || f.type === typeFilter
    return statusMatch && typeMatch
  })

  function openAdd() { setEditing(null); setForm(empty); setError(''); setModal(true) }
  function openEdit(fu: Followup) {
    setEditing(fu)
    setForm({
      customer_id: fu.customer_id,
      query_description: fu.query_description,
      possible_solution: fu.possible_solution || '',
      priority: fu.priority,
      due_date: fu.due_date ? fu.due_date.slice(0, 16) : '',
      notes: fu.resolution_notes || '',
      status: fu.status,
    })
    setError('')
    setModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      customer_id: form.customer_id,
      query_description: form.query_description,
      possible_solution: form.possible_solution || null,
      priority: form.priority,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
      resolution_notes: form.notes || null,
      status: form.status,
      resolved_at: form.status === 'resolved' ? new Date().toISOString() : null,
    }
    if (editing) {
      const fromStatus = editing.status
      const { error } = await supabase.from('followups').update(payload).eq('id', editing.id)
      if (error) setError(error.message)
      else if (form.status !== fromStatus) {
        await insertFollowupHistory(supabase, editing.id, userId, fromStatus, form.status)
      }
    } else {
      const { error } = await supabase.from('followups').insert({ ...payload, agent_id: userId, created_by: userId, type: 'followup' })
      if (error) setError(error.message)
    }
    setSaving(false)
    if (!error) { setModal(false); router.refresh() }
  }

  async function updateStatus(id: string, status: FollowupStatus) {
    const current = followups.find(f => f.id === id)
    await supabase.from('followups').update({
      status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    }).eq('id', id)
    if (current && current.status !== status) {
      await insertFollowupHistory(supabase, id, userId, current.status, status)
    }
    router.refresh()
  }

  const tabCls = (active: boolean, accent = 'blue') =>
    `px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
      active ? `bg-${accent}-600 text-white` : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
    }`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
          {['all', 'open', 'in_progress', 'resolved', 'closed'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={tabCls(filter === s)}>
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
          {['all', 'followup', 'escalation'].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} className={tabCls(typeFilter === t, 'indigo')}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Add Follow-up
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 py-16 text-center">
          <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No follow-ups found</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800 shadow-sm">
          {filtered.map(fu => (
            <div key={fu.id} className="px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`rounded-lg p-2 shrink-0 ${fu.type === 'escalation' ? 'bg-red-50 dark:bg-red-900/30' : 'bg-blue-50 dark:bg-blue-900/30'}`}>
                    {fu.type === 'escalation'
                      ? <AlertTriangle className="w-4 h-4 text-red-500 dark:text-red-400" />
                      : <FileText className="w-4 h-4 text-blue-500 dark:text-blue-400" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-medium text-gray-900 dark:text-white">{fu.customers?.name || 'Unknown'}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${fu.type === 'escalation' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'}`}>
                        {fu.type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{fu.customers?.phone}</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{fu.query_description}</p>
                    {fu.possible_solution && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Solution: {fu.possible_solution}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      {fu.due_date && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <Clock className="w-3 h-3" />Due {format(new Date(fu.due_date), 'dd MMM yyyy')}
                        </span>
                      )}
                      {(isAdmin || isManagement) && fu.profiles && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">Agent: {(fu.profiles as any).full_name}</span>
                      )}
                      {fu.creator && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">by {(fu.creator as any).full_name}</span>
                      )}
                    </div>
                    {!isManagement && fu.status !== 'resolved' && fu.status !== 'closed' && (
                      <div className="flex items-center gap-2 mt-2">
                        {fu.status === 'open' && (
                          <button onClick={() => updateStatus(fu.id, 'in_progress')} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 font-medium">Start working</button>
                        )}
                        {fu.status === 'in_progress' && (
                          <button onClick={() => updateStatus(fu.id, 'resolved')} className="text-xs text-green-600 dark:text-green-400 hover:text-green-800 font-medium flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Mark resolved
                          </button>
                        )}
                        <span className="text-gray-300 dark:text-gray-600">·</span>
                        <button onClick={() => openEdit(fu)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium">Edit</button>
                      </div>
                    )}
                    {isManagement && (
                      <div className="flex items-center gap-2 mt-2">
                        <button onClick={() => openEdit(fu)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium">Edit</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityBadge[fu.priority]}`}>{fu.priority}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[fu.status]}`}>{fu.status.replace('_', ' ')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isManagement ? (
        <ManagementFollowupModal
          open={modal}
          onClose={() => setModal(false)}
          editing={editing}
          customers={customers}
          agentCandidates={agentCandidates}
          teamLeaderCandidates={teamLeaderCandidates}
          history={editing ? historyByFollowup[editing.id] ?? [] : []}
          userId={userId}
          onSaved={() => { setModal(false); router.refresh() }}
        />
      ) : (
        <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Follow-up' : 'Add Follow-up'}>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className={labelCls}>Customer *</label>
              <select required value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className={inputCls}>
                <option value="">Select customer...</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Query Description *</label>
              <textarea required rows={3} value={form.query_description} onChange={e => setForm({ ...form, query_description: e.target.value })}
                className={`${inputCls} resize-none`} placeholder="Describe the customer's issue..." />
            </div>
            <div>
              <label className={labelCls}>Possible Solution</label>
              <textarea rows={2} value={form.possible_solution} onChange={e => setForm({ ...form, possible_solution: e.target.value })}
                className={`${inputCls} resize-none`} placeholder="Proposed resolution..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Priority</label>
                <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as any })} className={inputCls}>
                  {['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Due Date</label>
                <input type="datetime-local" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className={inputCls} />
              </div>
            </div>
            {editing && (
              <div>
                <label className={labelCls}>Status</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })} className={inputCls}>
                  {['open', 'in_progress', 'resolved', 'closed'].map(s => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>Resolution Notes</label>
              <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={`${inputCls} resize-none`} />
            </div>
            {editing && (
              <div>
                <p className={labelCls}>Status History</p>
                <StatusHistoryTimeline items={historyByFollowup[editing.id] ?? []} />
              </div>
            )}
            {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setModal(false)} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-medium">
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Follow-up'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
```

Note the button that opened the Add modal (`openAdd`, wired to the "+ Add Follow-up" button near the top) is unchanged — it's shared by both modal branches via the same `modal`/`editing` state.

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit`. Expect EXACTLY ONE error: `Cannot find module './ManagementFollowupModal'` (or equivalent "cannot find module" wording) in `components/followups/FollowupManager.tsx`, since Task 7 hasn't created that file yet. No other errors should appear — this confirms Task 5's props-mismatch error is now resolved.

- [ ] **Step 3: Commit**

```bash
git add components/followups/FollowupManager.tsx
git commit -m "feat: extend FollowupManager with management props and history wiring"
```

---

### Task 7: `ManagementFollowupModal` — the forked Add/Edit modal

**Files:**
- Create: `components/followups/ManagementFollowupModal.tsx`

**Interfaces:**
- Consumes: `Modal` from `@/components/ui/Modal`; `createClient` from `@/lib/supabase/client`; `insertFollowupHistory` (Task 3); `StatusHistoryTimeline` (Task 4); `Followup`, `FollowupStatus`, `FollowupAssignee`, `FollowupStatusHistory` from `@/types`.
- Produces: `ManagementFollowupModal` — default export. This resolves Task 6's expected "cannot find module" error.

- [ ] **Step 1: Create the modal**

Create `components/followups/ManagementFollowupModal.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Followup, FollowupStatus, FollowupAssignee, FollowupStatusHistory } from '@/types'
import { format } from 'date-fns'
import { insertFollowupHistory } from '@/lib/followups/insertFollowupHistory'
import StatusHistoryTimeline from './StatusHistoryTimeline'

const NEW_CUSTOMER = '__new__'

interface Props {
  open: boolean
  onClose: () => void
  editing: Followup | null
  customers: { id: string; name: string; phone: string }[]
  agentCandidates: FollowupAssignee[]
  teamLeaderCandidates: { profile_id: string; profiles: (FollowupAssignee & { is_active: boolean }) | null }[]
  history: FollowupStatusHistory[]
  userId: string
  onSaved: () => void
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function ManagementFollowupModal({
  open, onClose, editing, customers, agentCandidates, teamLeaderCandidates, history, userId, onSaved,
}: Props) {
  const [agentId, setAgentId] = useState(editing?.agent_id ?? '')
  const [customerId, setCustomerId] = useState(editing?.customer_id ?? '')
  const [queryDescription, setQueryDescription] = useState(editing?.query_description ?? '')
  const [status, setStatus] = useState<FollowupStatus>(editing?.status ?? 'open')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const teamLeaderOptions = useMemo(() => {
    const map = new Map<string, FollowupAssignee>()
    teamLeaderCandidates.forEach(tl => {
      const p = tl.profiles
      if (p && p.is_active && !map.has(p.id)) map.set(p.id, { id: p.id, full_name: p.full_name, email: p.email })
    })
    return Array.from(map.values())
  }, [teamLeaderCandidates])

  if (!open) return null

  const isNewCustomer = customerId === NEW_CUSTOMER

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!agentId) { setError('Please select who to assign this to.'); return }
    if (!customerId) { setError('Please select or create a customer.'); return }
    if (isNewCustomer && (!newCustomerName.trim() || !newCustomerPhone.trim())) {
      setError('Full name and phone are required for a new customer.')
      return
    }

    setSaving(true)
    setError('')
    const supabase = createClient()

    let finalCustomerId = customerId
    if (isNewCustomer) {
      const { data: newCustomer, error: custErr } = await supabase
        .from('customers')
        .insert({ name: newCustomerName.trim(), phone: newCustomerPhone.trim(), created_by: userId })
        .select()
        .single()
      if (custErr) { setError(custErr.message); setSaving(false); return }
      finalCustomerId = newCustomer.id
    }

    const payload = { customer_id: finalCustomerId, agent_id: agentId, query_description: queryDescription }
    const customerLabel = isNewCustomer ? newCustomerName.trim() : customers.find(c => c.id === finalCustomerId)?.name ?? ''

    if (editing) {
      const fromStatus = editing.status
      const { error: err } = await supabase
        .from('followups')
        .update({ ...payload, status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
        .eq('id', editing.id)
      if (err) { setError(err.message); setSaving(false); return }

      if (status !== fromStatus) {
        await insertFollowupHistory(supabase, editing.id, userId, fromStatus, status)
      }
      if (agentId !== editing.agent_id) {
        await supabase.from('notifications').insert({
          recipient_id: agentId,
          sender_id: userId,
          followup_id: editing.id,
          title: `Follow-up reassigned to you: ${customerLabel}`,
          message: queryDescription,
          type: 'followup',
        })
      }
    } else {
      const { data: created, error: err } = await supabase
        .from('followups')
        .insert({ ...payload, created_by: userId, type: 'followup', status: 'open' })
        .select()
        .single()
      if (err) { setError(err.message); setSaving(false); return }

      await supabase.from('notifications').insert({
        recipient_id: agentId,
        sender_id: userId,
        followup_id: created.id,
        title: `New follow-up: ${customerLabel}`,
        message: queryDescription,
        type: 'followup',
      })
    }

    setSaving(false)
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Follow-up' : 'Add Follow-up'}>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className={labelCls}>Assign to *</label>
          <select required value={agentId} onChange={e => setAgentId(e.target.value)} className={inputCls}>
            <option value="">Select agent or team leader...</option>
            <optgroup label="Agents">
              {agentCandidates.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </optgroup>
            <optgroup label="Team Leaders">
              {teamLeaderOptions.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
            </optgroup>
          </select>
        </div>

        <div>
          <label className={labelCls}>Customer *</label>
          <select required value={customerId} onChange={e => setCustomerId(e.target.value)} className={inputCls}>
            <option value="">Select customer...</option>
            <option value={NEW_CUSTOMER}>+ New Customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
          </select>
        </div>

        {isNewCustomer && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Full Name *</label>
              <input required value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone Number *</label>
              <input required value={newCustomerPhone} onChange={e => setNewCustomerPhone(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>Query Description *</label>
          <textarea required rows={3} value={queryDescription} onChange={e => setQueryDescription(e.target.value)}
            className={`${inputCls} resize-none`} placeholder="Describe the customer's issue..." />
        </div>

        {editing ? (
          <div>
            <label className={labelCls}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as FollowupStatus)} className={inputCls}>
              {['open', 'in_progress', 'resolved', 'closed'].map(s => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
            </select>
          </div>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500">Assigned {format(new Date(), 'dd MMM yyyy')}</p>
        )}

        {editing && (
          <div>
            <p className={labelCls}>Status History</p>
            <StatusHistoryTimeline items={history} />
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-medium">
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Follow-up'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect ZERO errors now (Task 6's expected "cannot find module" error is resolved).

Manual check, `npm run dev`, logged in as `management`, on `/followups`:
1. Confirm the page is no longer empty (or, if genuinely no rows exist yet for this account, confirm no error and an empty-state message).
2. Click "Add Follow-up" — confirm the modal shows exactly: Assign to (grouped Agents/Team Leaders), Customer (with "+ New Customer" option), Query Description, and an "Assigned {today's date}" line. Confirm NO Priority, Possible Solution, Due Date, or Resolution Notes fields appear.
3. Select "+ New Customer", fill in Name/Phone, assign to an agent, fill Query Description, submit. Confirm success, and confirm (via the Customers page or a direct query) the new customer was actually created.
4. Confirm the assigned agent received a `notifications` row (query directly).
5. Edit the follow-up you just created: change its assignee to a different agent — confirm a NEW notification goes to the new assignee. Change its Status — confirm a `followup_status_history` row appears and shows in the timeline.
6. Log in as the originally-assigned agent: confirm they no longer see this follow-up (since it was reassigned) but the newly-assigned agent does.

Report exact observations, not just "it worked."

- [ ] **Step 3: Commit**

```bash
git add components/followups/ManagementFollowupModal.tsx
git commit -m "feat: add ManagementFollowupModal for assign-and-notify follow-up flow"
```

---

### Task 8: Full manual QA pass

**Files:** none (verification only — if QA finds a bug, fix it in the relevant file and commit that fix separately with a clear message).

**Interfaces:** N/A.

- [ ] **Step 1: Agent regression check**

Log in as `agent`: confirm the Follow-ups page and Add/Edit modal are completely unchanged from before this plan — same fields (Customer, Query Description, Possible Solution, Priority, Due Date, Status on edit, Resolution Notes), self-assigned on create, "Start working"/"Mark resolved" quick actions still present. Create one, change its status via the quick-action button, and confirm a `followup_status_history` row is created for THIS path too (proving the "universal" history requirement, not just management's).

- [ ] **Step 2: Admin regression check**

Log in as `admin`: confirm unchanged behavior, and confirm they still see every followup in the system (not just their own), including ones created by `management` in Step 3 below.

- [ ] **Step 3: Full management journey**

Log in as `management`, on `/followups`:
1. Create a follow-up assigned to a team leader (not just an agent) — confirm the combined dropdown actually lists team leaders in their own group and the assignment/notification works identically to assigning an agent.
2. Confirm the list view shows what you've created, with correct status badges.
3. Edit one to mark it `resolved` — confirm `resolved_at` is set and the history timeline reflects the transition.

- [ ] **Step 4: RLS boundary check**

Using a minted JWT (or equivalent), confirm an `agent`-role session cannot read or update a `followups` row that isn't theirs (not `agent_id` or `created_by` = them), and cannot insert a `followup_status_history` row for a followup they have no relationship to.

- [ ] **Step 5: Final commit (only if QA fixes were made)**

If Steps 1-4 required any code fixes, commit each individually with a message describing the specific bug fixed. If everything passed with no fixes needed, say so clearly.

---

## Plan Self-Review

**Spec coverage:** RLS widening + history table (Task 1), types (Task 2), shared history helper (Task 3), timeline display (Task 4), page query 3-way branch + candidate pools (Task 5), `FollowupManager` extension with safe-defaulted optional props (Task 6), the forked management modal with inline customer creation + combined assignee picker + notify (Task 7), and full cross-role QA including the "universal history" proof (Task 8) — every element of the approved design doc (`docs/superpowers/specs/2026-08-09-management-followups-design.md`) is covered: removed fields (Priority/Possible Solution/Due Date/Resolution Notes) only for management, kept Query Description, auto-stamped "assigned" date via `created_at`, inline customer quick-add, combined agent+team-leader picker with notification, full status-history timeline, and management retaining edit/reassign capability.

**Placeholder scan:** No TBD/TODO markers. Tasks 5 and 6 each disclose their one expected intermediate compile error explicitly, by name, resolved by the next task — not a silent placeholder.

**Type consistency:** `FollowupAssignee`, `FollowupStatusHistory`, and the `teamLeaderCandidates` shape (`{ profile_id: string; profiles: (FollowupAssignee & { is_active: boolean }) | null }[]`) are spelled identically across `types/index.ts`, `app/(app)/followups/page.tsx`, `FollowupManager.tsx`, and `ManagementFollowupModal.tsx`. `insertFollowupHistory`'s signature (`supabase, followupId, changedBy, fromStatus, toStatus`) is called identically from both `FollowupManager.tsx` (Task 6) and `ManagementFollowupModal.tsx` (Task 7). `StatusHistoryTimeline`'s `{ items }` prop is used identically at both its call sites.
