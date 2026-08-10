# Warnings System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let team leaders issue verbal/written/final warnings to their own team's agents, plain (non-leading) admins issue them to any agent org-wide, and management issue them to team leaders — all recorded, timestamped, editable/deletable only by whoever issued them, and surfaced on a new `/warnings` dashboard page visible only to `admin`/`management` roles.

**Architecture:** One new `warnings` table with RLS carrying the entire visibility/issuing-rights logic (the page does a single unfiltered `select *` and lets RLS determine what comes back). One page (`app/(app)/warnings/page.tsx`), one manager component (`WarningsManager.tsx`) that renders either a 4-tile flat view (team leader/plain admin) or a 5-tile tabbed view (management) from the same fetched data, and one shared create/edit modal (`WarningModal.tsx`) used by all three issuer types.

**Tech Stack:** Next.js 16 App Router (async Server Components + `'use client'` managers), Supabase Postgres + RLS, TypeScript, Tailwind, `date-fns` for timestamp formatting.

## Global Constraints

- No automated test suite exists in this project (per `CLAUDE.md`) — verification is `npx tsc --noEmit` after every task plus a final manual QA pass (Task 7).
- Warnings are **mutable**: `issued_by = auth.uid()` is the sole condition for UPDATE/DELETE, regardless of role or how broad that role's SELECT visibility is. This is a deliberate departure from every other audit-trail table in this app (which are all immutable) — do not "fix" it to be immutable.
- `is_submitter_team_leader(p_profile_id uuid)` already exists live in the database (added by the management-requests-approval migration) — reuse it exactly as-is; do not redefine or duplicate it.
- Plain (non-team-leading) admins get an **unscoped** version of a team leader's exact console (any agent, not just one team's) — they do NOT get visibility into team-leader-directed warnings; only `management` sees both categories. This is the opposite of the "admin sees everything" bypass used in every other feature built this session — do not apply that pattern here.
- The warned person (agent or team leader) gets **zero visibility** into their own warning record anywhere in this system — no RLS SELECT grant references `issued_to = auth.uid()`.
- `components/roster/RosterManager.tsx`'s and `components/followups/FollowupManager.tsx`'s established "stale modal state" bug class — a modal whose local state is lazily initialized from an `editing` prop must both (a) carry `key={editing?.id ?? 'add'}` at its call site AND (b) fully unmount when closed (render `{modal && (<Modal .../>)}`, not rely on an internal `if (!open) return null`) — applies to `WarningModal` from the start; this plan bakes in both parts of the fix rather than discovering the gap via review.

---

### Task 1: DB migrations — `warnings` table, RLS, and notification type

**Files:**
- Create: `supabase/migrations/warnings-schema.sql`
- Create: `supabase/migrations/warnings-notifications.sql`

**Interfaces:**
- Produces: table `warnings(id, issued_to, issued_by, type, reason, created_at, updated_at)`, RLS policies `warnings_insert`/`warnings_select`/`warnings_update`/`warnings_delete`, and a widened `notifications_type_check` constraint including `'warning'`.
- Consumes: existing `is_submitter_team_leader(p_profile_id uuid)` function, `team_leaders`, `team_members`, `profiles`, `notifications` tables (all pre-existing, read-only reference).

- [ ] **Step 1: Write `supabase/migrations/warnings-schema.sql`**

```sql
-- ============================================================
-- Warnings: team leaders issue verbal/written/final warnings to
-- their own team's agents; plain (non-leading) admins issue them
-- to any agent org-wide; management issues them to team leaders.
-- Reuses is_submitter_team_leader(profile_id), already live from
-- the management-requests-approval migration, to answer "is this
-- profile a team leader" for both the issuer and target side.
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

-- SELECT: same three-way scoping as INSERT, keyed off the row's issued_to;
-- management gets blanket visibility across both audiences.
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

- [ ] **Step 2: Write `supabase/migrations/warnings-notifications.sql`**

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

- [ ] **Step 3: Ask the human to run both migrations live**

This project has no migration runner — every `supabase/migrations/*.sql` file is applied by hand in the Supabase SQL Editor. Ask the human partner to run `warnings-schema.sql` first, then `warnings-notifications.sql`, confirming each completes with no errors before continuing.

- [ ] **Step 4: Verify the table, policies, and constraint exist**

Ask the human to confirm via a direct SQL query (the Dashboard's Policies UI has previously been found to not show full policy expression text):
```sql
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'warnings';
```
Expect 4 rows: `warnings_insert` (INSERT), `warnings_select` (SELECT), `warnings_update` (UPDATE), `warnings_delete` (DELETE). And:
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notifications_type_check';
```
Expect the definition text to include `'warning'::text`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/warnings-schema.sql supabase/migrations/warnings-notifications.sql
git commit -m "feat: add warnings table, RLS, and notification type"
```

---

### Task 2: Types — `types/index.ts` additions

**Files:**
- Modify: `types/index.ts`

**Interfaces:**
- Produces:
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
    target?: Pick<Profile, 'id' | 'full_name' | 'email' | 'role'>
    issuer?: Pick<Profile, 'id' | 'full_name' | 'email'>
  }
  export type WarningTargetCandidate = Pick<Profile, 'id' | 'full_name' | 'email'>
  ```
- Consumes: existing `Profile` interface (unchanged).

- [ ] **Step 1: Add the types**

Add near the existing `RequestApprovalHistory`/`Request` block in `types/index.ts`:

```ts
// ─── Warnings ─────────────────────────────────────────────────────────────────

export type WarningType = 'verbal' | 'written' | 'final'

export interface Warning {
  id: string
  issued_to: string
  issued_by: string
  type: WarningType
  reason: string
  created_at: string
  updated_at: string
  target?: Pick<Profile, 'id' | 'full_name' | 'email' | 'role'>
  issuer?: Pick<Profile, 'id' | 'full_name' | 'email'>
}

/** Shared shape for the "who can I warn" target-candidate pool */
export type WarningTargetCandidate = Pick<Profile, 'id' | 'full_name' | 'email'>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add Warning/WarningTargetCandidate types"
```

---

### Task 3: Page query wiring — `app/(app)/warnings/page.tsx`

**Files:**
- Create: `app/(app)/warnings/page.tsx`

**Interfaces:**
- Consumes: `Warning`, `WarningTargetCandidate` types (Task 2).
- Produces: passes `{ warnings: Warning[], targetCandidates: WarningTargetCandidate[], currentUserId: string, isManagement: boolean }` to `WarningsManager` (Task 4).

- [ ] **Step 1: Create `app/(app)/warnings/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { redirect } from 'next/navigation'
import Header from '@/components/layout/Header'
import WarningsManager from '@/components/warnings/WarningsManager'
import { Warning, WarningTargetCandidate } from '@/types'

export default async function WarningsPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  if (!userId) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .single()

  if (!profile) redirect('/login')
  if (profile.role === 'agent') redirect('/dashboard')

  const isAdmin = profile.role === 'admin'
  const isManagement = profile.role === 'management'

  const { data: teamLeaderRows } = isAdmin
    ? await supabase.from('team_leaders').select('team_id').eq('profile_id', userId)
    : { data: [] as { team_id: string }[] }
  const isTeamLeader = (teamLeaderRows ?? []).length > 0

  // RLS alone determines which rows come back — no manual filtering needed.
  // target.role is fetched specifically so the client can split management's
  // list into "Agent Warnings" vs "Team-Leader Warnings" (issued_to is never
  // anything but 'agent' or 'admin', per the warnings_insert policy).
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

  return (
    <div className="flex-1 overflow-auto">
      <Header title="Warnings" userId={profile.id} userRole={profile.role} />
      <div className="p-6">
        <WarningsManager
          warnings={(warnings ?? []) as Warning[]}
          targetCandidates={targetCandidates}
          currentUserId={userId}
          isManagement={isManagement}
        />
      </div>
    </div>
  )
}
```

Note: `profile.role === 'agent'` redirect here is a defense-in-depth belt-and-braces check — `proxy.ts` (Task 6) is the actual enforcement layer, matching the three-layer authorization convention (`proxy.ts` / page query / RLS) already documented in `CLAUDE.md`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors referencing the not-yet-created `@/components/warnings/WarningsManager` module — this is expected until Task 4. Confirm no OTHER errors exist in this file itself (e.g., re-read the error output and confirm every error is exactly the missing-module error, nothing about types within this file).

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/warnings/page.tsx"
git commit -m "feat: add warnings page query layer"
```

---

### Task 4: `WarningsManager.tsx` — dashboard tiles + browsable list

**Files:**
- Create: `components/warnings/WarningsManager.tsx`

**Interfaces:**
- Consumes: `Warning`, `WarningTargetCandidate` types (Task 2). Will render `WarningModal` (Task 5) — since Task 5 doesn't exist yet, this task creates the call site with the exact props Task 5's brief specifies, and the project will not fully typecheck until Task 5 lands (same pattern as Task 3 → Task 4).
- Produces: default export `WarningsManager({ warnings: Warning[], targetCandidates: WarningTargetCandidate[], currentUserId: string, isManagement: boolean })`, consumed by `app/(app)/warnings/page.tsx` (Task 3, already wired).

- [ ] **Step 1: Create `components/warnings/WarningsManager.tsx`**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Warning, WarningTargetCandidate, WarningType } from '@/types'
import { AlertTriangle, MessageSquare, FileText, ShieldAlert, Plus } from 'lucide-react'
import { format } from 'date-fns'
import WarningModal from './WarningModal'

interface Props {
  warnings: Warning[]
  targetCandidates: WarningTargetCandidate[]
  currentUserId: string
  isManagement: boolean
}

type ListTab = 'agent' | 'team_leader'

const typeBadge: Record<WarningType, string> = {
  verbal:  'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
  written: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400',
  final:   'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
}

const typeLabel: Record<WarningType, string> = {
  verbal: 'Verbal',
  written: 'Written',
  final: 'Final',
}

const tileCls = 'bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800'

export default function WarningsManager({ warnings, targetCandidates, currentUserId, isManagement }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [tab, setTab] = useState<ListTab>('agent')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Warning | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [error, setError] = useState('')

  const counts = useMemo(() => {
    const agentWarnings = warnings.filter(w => w.target?.role === 'agent')
    const teamLeaderWarnings = warnings.filter(w => w.target?.role === 'admin')
    const relevant = isManagement ? warnings : agentWarnings
    return {
      totalAgent: agentWarnings.length,
      totalTeamLeader: teamLeaderWarnings.length,
      verbal: relevant.filter(w => w.type === 'verbal').length,
      written: relevant.filter(w => w.type === 'written').length,
      final: relevant.filter(w => w.type === 'final').length,
    }
  }, [warnings, isManagement])

  const displayed = useMemo(() => {
    if (!isManagement) return warnings
    return warnings.filter(w => (tab === 'agent' ? w.target?.role === 'agent' : w.target?.role === 'admin'))
  }, [warnings, isManagement, tab])

  function openAdd() { setEditing(null); setError(''); setModal(true) }
  function openEdit(w: Warning) { setEditing(w); setError(''); setModal(true) }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('warnings').delete().eq('id', id)
    if (error) { setError(error.message); return }
    setConfirmingDelete(null)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 ${isManagement ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4`}>
        {isManagement ? (
          <>
            <div className={tileCls}>
              <div className="flex items-center justify-between mb-3">
                <div className="bg-blue-500 rounded-lg p-2"><AlertTriangle className="w-5 h-5 text-white" /></div>
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.totalAgent}</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Total Agent Warnings</p>
            </div>
            <div className={tileCls}>
              <div className="flex items-center justify-between mb-3">
                <div className="bg-indigo-500 rounded-lg p-2"><AlertTriangle className="w-5 h-5 text-white" /></div>
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.totalTeamLeader}</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Total Team-Leader Warnings</p>
            </div>
          </>
        ) : (
          <div className={tileCls}>
            <div className="flex items-center justify-between mb-3">
              <div className="bg-blue-500 rounded-lg p-2"><AlertTriangle className="w-5 h-5 text-white" /></div>
              <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.totalAgent}</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Total Recorded Warnings</p>
          </div>
        )}
        <div className={tileCls}>
          <div className="flex items-center justify-between mb-3">
            <div className="bg-yellow-500 rounded-lg p-2"><MessageSquare className="w-5 h-5 text-white" /></div>
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.verbal}</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Verbal Warnings</p>
        </div>
        <div className={tileCls}>
          <div className="flex items-center justify-between mb-3">
            <div className="bg-orange-500 rounded-lg p-2"><FileText className="w-5 h-5 text-white" /></div>
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.written}</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Written Warnings</p>
        </div>
        <div className={tileCls}>
          <div className="flex items-center justify-between mb-3">
            <div className="bg-red-500 rounded-lg p-2"><ShieldAlert className="w-5 h-5 text-white" /></div>
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.final}</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Final Warnings</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isManagement && (
          <div className="flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
            {(['agent', 'team_leader'] as ListTab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {t === 'agent' ? 'Agent Warnings' : 'Team-Leader Warnings'}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors ml-auto"
        >
          <Plus className="w-4 h-4" /> New Warning
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}

      {displayed.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 py-16 text-center">
          <AlertTriangle className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No warnings recorded</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800 shadow-sm">
          {displayed.map(w => (
            <div key={w.id} className="px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-medium text-gray-900 dark:text-white">{w.target?.full_name ?? 'Unknown'}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeBadge[w.type]}`}>{typeLabel[w.type]}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{w.reason}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {format(new Date(w.created_at), 'dd MMM yyyy HH:mm')} · by {w.issuer?.full_name ?? 'Unknown'}
                  </p>
                </div>
                {w.issued_by === currentUserId && (
                  <div className="flex items-center gap-2 shrink-0">
                    {confirmingDelete === w.id ? (
                      <>
                        <button onClick={() => handleDelete(w.id)} className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 font-medium">Confirm Delete</button>
                        <button onClick={() => setConfirmingDelete(null)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => openEdit(w)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium">Edit</button>
                        <button onClick={() => setConfirmingDelete(w.id)} className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 font-medium">Delete</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <WarningModal
          key={editing?.id ?? 'add'}
          open={modal}
          onClose={() => setModal(false)}
          editing={editing}
          targetCandidates={targetCandidates}
          currentUserId={currentUserId}
          onSaved={() => { setModal(false); router.refresh() }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: an error referencing the not-yet-created `./WarningModal` module — expected until Task 5. Confirm no other errors exist.

- [ ] **Step 3: Commit**

```bash
git add components/warnings/WarningsManager.tsx
git commit -m "feat: add WarningsManager dashboard and list"
```

---

### Task 5: `WarningModal.tsx` — create/edit form

**Files:**
- Create: `components/warnings/WarningModal.tsx`

**Interfaces:**
- Consumes: `Warning`, `WarningTargetCandidate`, `WarningType` types (Task 2). `Modal` from `@/components/ui/Modal` (existing, unchanged — props `{ open, onClose, title, children }`).
- Produces: default export `WarningModal({ open: boolean, onClose: () => void, editing: Warning | null, targetCandidates: WarningTargetCandidate[], currentUserId: string, onSaved: () => void })` — matches exactly what Task 4's `WarningsManager.tsx` already calls it with.

- [ ] **Step 1: Create `components/warnings/WarningModal.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Warning, WarningTargetCandidate, WarningType } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  editing: Warning | null
  targetCandidates: WarningTargetCandidate[]
  currentUserId: string
  onSaved: () => void
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function WarningModal({ open, onClose, editing, targetCandidates, currentUserId, onSaved }: Props) {
  const [targetId, setTargetId] = useState(editing?.issued_to ?? '')
  const [type, setType] = useState<WarningType>(editing?.type ?? 'verbal')
  const [reason, setReason] = useState(editing?.reason ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const supabase = createClient()

    if (editing) {
      const { error: err } = await supabase.from('warnings').update({ type, reason }).eq('id', editing.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      if (!targetId) { setError('Please select who this warning is for.'); setSaving(false); return }

      const { data: created, error: err } = await supabase
        .from('warnings')
        .insert({ issued_to: targetId, issued_by: currentUserId, type, reason })
        .select()
        .single()
      if (err) { setError(err.message); setSaving(false); return }

      const targetLabel = targetCandidates.find(c => c.id === targetId)?.full_name ?? ''
      await supabase.from('notifications').insert({
        recipient_id: targetId,
        sender_id: currentUserId,
        title: `You have received a ${type} warning`,
        message: reason,
        type: 'warning',
      })
      void created // insert result unused beyond confirming success; no deep-link needed (see spec)
      void targetLabel
    }

    setSaving(false)
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Warning' : 'New Warning'}>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className={labelCls}>Warning For *</label>
          <select
            required
            disabled={!!editing}
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            className={`${inputCls} disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            <option value="">Select...</option>
            {targetCandidates.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>

        <div>
          <label className={labelCls}>Type *</label>
          <select required value={type} onChange={e => setType(e.target.value as WarningType)} className={inputCls}>
            <option value="verbal">Verbal</option>
            <option value="written">Written</option>
            <option value="final">Final</option>
          </select>
        </div>

        <div>
          <label className={labelCls}>Reason *</label>
          <textarea
            required
            rows={4}
            value={reason}
            onChange={e => setReason(e.target.value)}
            className={`${inputCls} resize-none`}
            placeholder="Describe the reason for this warning..."
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-medium">
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Issue Warning'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

Note on the two `void` statements: `created` (the inserted row) and `targetLabel` are computed but not otherwise used — `created` only to confirm the insert succeeded before notifying (its error is what's checked, not its data), and `targetLabel` was computed for a notification body that, per the design, doesn't need the target's name in the message (the recipient already knows who they are) — both are marked `void` rather than removed so a future reviewer doesn't mistake them for accidentally-incomplete code. If this feels like unnecessary noise, it is acceptable to simply delete the `targetLabel` computation and the `void created` line entirely, since neither is load-bearing — do so if `tsc`/lint flags them as unused rather than leaving the `void` workaround.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors (this is the task that completes the `WarningsManager` → `WarningModal` chain, and the `page.tsx` → `WarningsManager` chain — the whole feature should now compile cleanly end to end).

- [ ] **Step 3: Manual smoke test**

Start the dev server (`npm run dev`) and confirm `/warnings` compiles and serves without a server-side error for at least one authenticated session (any role). Full multi-role interactive verification happens in Task 7 — this step is just confirming the newly-completed chain doesn't crash outright.

- [ ] **Step 4: Commit**

```bash
git add components/warnings/WarningModal.tsx
git commit -m "feat: add WarningModal create/edit form"
```

---

### Task 6: Sidebar link and route gate

**Files:**
- Modify: `components/layout/Sidebar.tsx`
- Modify: `proxy.ts`

**Interfaces:** None — this task only adds navigation/routing, no new exports consumed by other tasks.

- [ ] **Step 1: Add the Warnings nav link in `components/layout/Sidebar.tsx`**

Add `AlertTriangle` to the existing `lucide-react` import (currently `LayoutDashboard, Users, Phone, FileText, ShieldAlert, LogOut, UserCog, CalendarDays, Settings, Inbox, Pencil, Eye, EyeOff, Check, Handshake, Users2`):

```tsx
import {
  LayoutDashboard, Users, Phone, FileText, ShieldAlert, LogOut, UserCog,
  CalendarDays, Settings, Inbox, Pencil, Eye, EyeOff, Check, Handshake, Users2,
  AlertTriangle,
} from 'lucide-react'
```

Change `getPrimaryLinks` from:

```tsx
function getPrimaryLinks(role: Role) {
  return [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    role === 'management'
      ? { href: '/coaching', label: 'Coaching', icon: Handshake }
      : { href: '/customers', label: 'Customers', icon: Users },
    role === 'management'
      ? { href: '/team-leaders', label: 'Team Management', icon: Users2 }
      : { href: '/callbacks', label: 'Callbacks', icon: Phone },
    { href: '/followups', label: 'Follow-ups', icon: FileText },
    { href: '/roster', label: 'Team Roster', icon: CalendarDays },
  ]
}
```

to:

```tsx
function getPrimaryLinks(role: Role) {
  const links = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    role === 'management'
      ? { href: '/coaching', label: 'Coaching', icon: Handshake }
      : { href: '/customers', label: 'Customers', icon: Users },
    role === 'management'
      ? { href: '/team-leaders', label: 'Team Management', icon: Users2 }
      : { href: '/callbacks', label: 'Callbacks', icon: Phone },
    { href: '/followups', label: 'Follow-ups', icon: FileText },
    { href: '/roster', label: 'Team Roster', icon: CalendarDays },
  ]
  if (role !== 'agent') {
    links.push({ href: '/warnings', label: 'Warnings', icon: AlertTriangle })
  }
  return links
}
```

- [ ] **Step 2: Add the route gate in `proxy.ts`**

Change:

```ts
    if (pathname.startsWith('/team-leaders') && profile?.role !== 'management') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }
```

to:

```ts
    if (pathname.startsWith('/team-leaders') && profile?.role !== 'management') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    if (pathname.startsWith('/warnings') && profile?.role === 'agent') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Manual verification**

Start the dev server. Confirm: as `agent`, no "Warnings" link appears in the sidebar, and navigating directly to `/warnings` redirects to `/dashboard`. As `admin` and `management`, the "Warnings" link appears and the page loads.

- [ ] **Step 5: Commit**

```bash
git add components/layout/Sidebar.tsx proxy.ts
git commit -m "feat: add Warnings nav link and route gate"
```

---

### Task 7: Full manual QA pass

**Files:** none (verification only).

- [ ] **Step 1: RLS boundary check via minted sessions**

Using the same minted-JWT-against-PostgREST technique used for the management-requests-approval feature's QA pass (a script exists in this session's scratchpad directory at the path used previously — reconstruct it if it's no longer present: sign an HS256 JWT with `SUPABASE_JWT_SECRET` from `.env.local`, `role: 'authenticated'`, `sub: <profile-uuid>`, 1-hour expiry, using the `jose` package's `SignJWT`), confirm directly against PostgREST:

- A team leader can INSERT a warning for one of their own team's agents; cannot INSERT one for an agent NOT on their team; cannot INSERT one for another team leader or for management.
- A plain (non-team-leading) admin can INSERT a warning for any agent, regardless of team; cannot INSERT one for a team leader.
- Management can INSERT a warning for a team leader; cannot INSERT one for an agent.
- A team leader's own agent-directed warning is SELECT-able by: themselves, any plain admin (their SELECT policy is unscoped for every agent-directed warning — it checks `target.role = 'agent'`, not team membership, so it has no notion of "which team" to exclude), and management. Confirm a genuinely unrelated agent cannot see any warning at all, including their own.
- A plain admin's agent-directed warning is SELECT-able by any other admin (team-leading or not, same unscoped-by-role-only check) and by management (management's SELECT policy is an unconditional bypass with no team/admin-type restriction — it sees both audiences).
- A management-issued team-leader-directed warning is NOT SELECT-able by a plain admin, and NOT SELECT-able by a different team leader (neither branch of the non-management admin SELECT policy ever matches a team-leader-role target).
- UPDATE/DELETE on any warning succeeds only for the profile that is that row's `issued_by`, regardless of role — confirm a plain admin cannot edit/delete a team-leader-directed warning issued by management, and management cannot edit/delete an agent-directed warning issued by a team leader, even though management CAN see it.

- [ ] **Step 2: Notification check**

Issue a warning as a team leader to one of their agents; confirm the agent's profile received exactly one `notifications` row with `type = 'warning'`. Issue a warning as management to a team leader; confirm that team leader received exactly one `notifications` row with `type = 'warning'`. Confirm editing an existing warning does NOT produce a second notification.

- [ ] **Step 3: End-to-end UI pass**

In a real browser (or via the minted-session + direct page load if no browser automation is available in this environment — note explicitly which method was used): log in as a team leader, confirm the 4-tile dashboard and flat list show only their team's agents' warnings, issue one, edit it, delete it. Log in as a plain admin, confirm the same 4-tile shape scoped to all agents instead. Log in as management, confirm the 5-tile dashboard, the two-tab list, and that editing/deleting only works on rows management itself issued.

- [ ] **Step 4: Clean up test data**

Delete every `warnings` and `notifications` row created during this QA pass (service-role key), and confirm they're gone with a follow-up SELECT.

No commit for this task — it's verification only. If any step reveals a genuine bug, fix it as a normal follow-up commit on this branch before calling the plan complete.
