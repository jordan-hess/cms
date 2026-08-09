# Management Console Attendance Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the previously-empty "Management" console-desktop window with a live, today-only attendance summary: Total Staff, six agent status categories (Present/Late/Absent/Sick/On Leave/Off), and a "Team Leaders on Shift" count — each expandable to the actual names.

**Architecture:** Widen two admin-only RLS read policies (`attendance_select`, `roster_overrides_select`) to also allow `management`. Extend `app/(app)/dashboard/page.tsx`'s existing parallel-fetch pattern with one more `Promise.all` block, gated to `role === 'management'`, that pulls today's roster/attendance data flat (no RPC, no view). Reuse the existing `resolveShift`/`buildSlotMap` functions (already powering the Roster page) to compute each agent's status for today, so this console's numbers can never disagree with the Roster page's own day view. A rewritten `ManagementConsole` client component groups the results into the six display categories client-side and renders them with a new small presentational row component, matching every other console/manager component's "server fetches flat data, client derives the view-model" split.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), Tailwind, `lucide-react`. No new dependencies.

## Global Constraints

- No automated test suite exists in this project (confirmed in `CLAUDE.md`) — every task's "verify" step is a manual/live check, consistent with how every other feature in this codebase has been verified.
- All `profiles(...)` selects/embeds MUST use explicit column lists — never `select('*')`. This codebase had a real incident (bcrypt hashes leaking into RSC payloads) from that exact pattern; it was fixed everywhere and must not be reintroduced.
- `team_leaders` has TWO foreign keys to `profiles` (`profile_id`, `assigned_by`) — any PostgREST embed of `profiles` through `team_leaders` MUST be qualified as `profiles!team_leaders_profile_id_fkey(...)` or PostgREST returns an error instead of rows.
- Never reconstruct a `Date` from a `'YYYY-MM-DD'` string via `new Date(str)` — that form is parsed as UTC midnight and can roll back a calendar day in negative-UTC-offset timezones. Build local dates explicitly (`new Date(y, m - 1, d)`), matching `lib/roster/calendarUtils.ts`'s own helpers.
- An agent with no team membership or no rotation for the current week resolves to `effectiveStatus: 'no_rotation'` (from `resolveShift`) — this folds into the **Off** category for this console, per the approved design spec (`docs/superpowers/specs/2026-08-08-management-console-attendance-design.md`). This is a deliberate scope decision, not a bug.
- This console shows **today only** — no date picker, no historical view. The Roster page remains the place to browse other days.
- Team leaders have no rotation/shift concept at all in this schema. A leader counts as on shift by default and only counts otherwise if there's an explicit `attendance_records` row for them today. There is currently no UI anywhere to create that row for a leader — this plan does not add one; it only displays whatever `attendance_records` already contains.
- Total Staff = active agents + active team leaders only. Other `admin`/`management`-role accounts are not part of the roster/shift system and are not counted.
- This is read-only widening — no INSERT/UPDATE/DELETE policy changes. The console only displays data; it never marks attendance.

---

### Task 1: RLS migration — widen attendance read policies to include `management`

**Files:**
- Create: `supabase/migrations/management-attendance-read-access.sql`

**Interfaces:**
- Consumes: nothing new.
- Produces: a live database change. After this task, a `management`-role authenticated session can `SELECT` any row of `attendance_records` and `roster_overrides` (not just its own). An `agent`-role session must still be restricted to its own rows only.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/management-attendance-read-access.sql`:

```sql
-- ============================================================
-- Widen read-only RLS policies so 'management' can view today's
-- attendance data, for the new Management console attendance
-- summary.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — policies are dropped and
-- recreated with an added role check; no data or table changes.
-- No INSERT/UPDATE/DELETE policies are touched — this is
-- read-only widening.
-- ============================================================

DROP POLICY IF EXISTS "attendance_select" ON attendance_records;
CREATE POLICY "attendance_select" ON attendance_records FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));

DROP POLICY IF EXISTS "roster_overrides_select" ON roster_overrides;
CREATE POLICY "roster_overrides_select" ON roster_overrides FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management')));
```

- [ ] **Step 2: Run it live**

Run this file's contents in the Supabase SQL Editor.

- [ ] **Step 3: Verify live**

Using a real `management` session's minted JWT (mint via `/api/auth/supabase-token` after logging in, then use the anon key + that JWT), attempt a real `SELECT` against `attendance_records` and `roster_overrides` for a row that does **not** belong to that management user — both must now return the row instead of an empty result. Then repeat with an `agent` session's JWT querying another user's row on both tables — both must still return empty (RLS still blocks it). Also confirm an `agent` can still read their own row on both tables (unchanged).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/management-attendance-read-access.sql
git commit -m "feat: widen attendance/roster-override read policies to also allow management role"
```

---

### Task 2: Wire data fetching — `dashboard/page.tsx` + `ConsoleDesktop.tsx`

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `components/console/ConsoleDesktop.tsx`

**Interfaces:**
- Consumes: `formatDateKey`, `getISOWeekStart` from `@/lib/roster/calendarUtils` (both already exist); `ManagementConsoleProps` (a type this task imports from `./ManagementConsole` but does not yet define — see Step 4, this is expected to fail type-checking until Task 3).
- Produces: a `managementData` object of this exact shape, built only when `profile.role === 'management'`, passed into `<ConsoleDesktop managementData={managementData} />`:
  ```ts
  {
    agents: { id: string; full_name: string }[]
    teamMembers: TeamMember[]
    teamRotations: TeamRotation[]
    attendanceRecords: AttendanceRecord[]
    rosterOverrides: RosterOverride[]
    leaders: { id: string; full_name: string }[]
    todayIso: string   // 'YYYY-MM-DD'
  }
  ```
  Task 3's `ManagementConsole` component must accept exactly this shape as its props.

- [ ] **Step 1: Add the management-only fetch block to `dashboard/page.tsx`**

In `app/(app)/dashboard/page.tsx`, add the import alongside the existing ones:

```ts
import { formatDateKey, getISOWeekStart } from '@/lib/roster/calendarUtils'
```

Replace the `if (profile?.role === 'admin' || profile?.role === 'management')` block with:

```tsx
  if (profile?.role === 'admin' || profile?.role === 'management') {
    let managementData
    if (profile.role === 'management') {
      const now = new Date()
      const todayIso = formatDateKey(now)
      const weekStart = formatDateKey(getISOWeekStart(now))

      const [
        { data: agents },
        { data: teamMembers },
        { data: teamRotations },
        { data: attendanceRecords },
        { data: rosterOverrides },
        { data: teamLeaders },
      ] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('role', 'agent').eq('is_active', true),
        supabase.from('team_members').select('id, team_id, profile_id, joined_at'),
        supabase.from('team_rotations').select('*, shift_templates(*)').eq('week_start_date', weekStart),
        supabase.from('attendance_records').select('*').eq('date', todayIso),
        supabase.from('roster_overrides').select('*, shift_templates(*)').eq('date', todayIso),
        supabase.from('team_leaders').select('id, profile_id, profiles!team_leaders_profile_id_fkey(id, full_name, is_active)'),
      ])

      const leaders = (teamLeaders || [])
        .map(tl => tl.profiles)
        .filter(p => p != null && p.is_active)
        .map(p => ({ id: p.id, full_name: p.full_name }))

      managementData = {
        agents: agents || [],
        teamMembers: teamMembers || [],
        teamRotations: teamRotations || [],
        attendanceRecords: attendanceRecords || [],
        rosterOverrides: rosterOverrides || [],
        leaders,
        todayIso,
      }
    }

    return (
      <div className="h-full">
        <ConsoleDesktop
          role={profile.role}
          dashboardData={{ stats, pendingCallbacks, openFollowups, urgentFollowups }}
          managementData={managementData}
        />
      </div>
    )
  }
```

Leave everything else in the file (the initial `Promise.all`, `pendingCallbacks`/`openFollowups`/`urgentFollowups`/`stats` derivations, and the final `return` for the plain-agent view) exactly as-is.

- [ ] **Step 2: Add the `managementData` prop to `ConsoleDesktopProps`**

In `components/console/ConsoleDesktop.tsx`, add this import alongside the existing ones:

```ts
import type { ManagementConsoleProps } from './ManagementConsole'
```

Change the props interface:

```ts
export interface ConsoleDesktopProps {
  role: 'admin' | 'management'
  dashboardData: DashboardContentProps
  managementData?: ManagementConsoleProps
}
```

Change the component signature:

```ts
export default function ConsoleDesktop({ role, dashboardData, managementData }: ConsoleDesktopProps) {
```

- [ ] **Step 3: Pass `managementData` through in `renderConsole`**

In the same file, change the `'management'` case of `renderConsole`:

```ts
      case 'management':
        return managementData ? <ManagementConsole {...managementData} /> : null
```

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit`. Expect exactly one error, on the `import type { ManagementConsoleProps } from './ManagementConsole'` line in `components/console/ConsoleDesktop.tsx`:

```
Module '"./ManagementConsole"' has no exported member 'ManagementConsoleProps'.
```

This is expected — `ManagementConsole.tsx` is still the zero-props stub and doesn't export this type yet. Task 3 resolves it. No other errors should appear.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/dashboard/page.tsx" components/console/ConsoleDesktop.tsx
git commit -m "feat: fetch today's roster/attendance data for the Management console"
```

---

### Task 3: Build `AttendanceCategoryRow` and rewrite `ManagementConsole`

**Files:**
- Create: `components/console/AttendanceCategoryRow.tsx`
- Modify: `components/console/ManagementConsole.tsx`

**Interfaces:**
- Consumes: `buildSlotMap` from `@/lib/roster/resolveShift`; `statusColorClasses`, `statusLabels` from `@/lib/roster/teamColors`; `AttendanceStatus`, `TeamMember`, `TeamRotation`, `AttendanceRecord`, `RosterOverride` from `@/types`; the exact `managementData` shape produced by Task 2.
- Produces: `ManagementConsoleProps` (exported interface, matching Task 2's shape field-for-field) and the default-exported `ManagementConsole` component that Task 2's `ConsoleDesktop.tsx` already imports and renders.

- [ ] **Step 1: Add `AttendanceCategoryRow`**

Create `components/console/AttendanceCategoryRow.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export interface AttendanceCategoryRowProps {
  label: string
  colorClasses: { bg: string; text: string }
  people: { id: string; full_name: string }[]
}

export default function AttendanceCategoryRow({ label, colorClasses, people }: AttendanceCategoryRowProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2"
      >
        <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
        <span className="flex items-center gap-2">
          <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${colorClasses.bg} ${colorClasses.text}`}>
            {people.length}
          </span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-0.5">
          {people.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">None</p>
          ) : (
            people.map(person => (
              <p key={person.id} className="text-xs text-gray-600 dark:text-gray-400">{person.full_name}</p>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `ManagementConsole`**

Replace the full contents of `components/console/ManagementConsole.tsx`:

```tsx
'use client'

import { AttendanceStatus, TeamMember, TeamRotation, AttendanceRecord, RosterOverride } from '@/types'
import { buildSlotMap } from '@/lib/roster/resolveShift'
import { statusColorClasses, statusLabels } from '@/lib/roster/teamColors'
import AttendanceCategoryRow from './AttendanceCategoryRow'

type PersonLite = { id: string; full_name: string }

export interface ManagementConsoleProps {
  agents: PersonLite[]
  teamMembers: TeamMember[]
  teamRotations: TeamRotation[]
  attendanceRecords: AttendanceRecord[]
  rosterOverrides: RosterOverride[]
  leaders: PersonLite[]
  todayIso: string
}

const AGENT_CATEGORIES: AttendanceStatus[] = ['on_shift', 'late', 'absent', 'sick', 'leave', 'off']

// 'YYYY-MM-DD' strings parsed via `new Date(str)` are read as UTC midnight, which can
// roll back a calendar day in negative-UTC-offset timezones — build a local date
// explicitly instead, matching lib/roster/calendarUtils.ts's own helpers.
function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export default function ManagementConsole({
  agents, teamMembers, teamRotations, attendanceRecords, rosterOverrides, leaders, todayIso,
}: ManagementConsoleProps) {
  const today = parseIsoDateLocal(todayIso)
  const slotMap = buildSlotMap(agents, [today], teamMembers, teamRotations, attendanceRecords, rosterOverrides)

  const buckets: Record<AttendanceStatus, PersonLite[]> = {
    on_shift: [], late: [], absent: [], sick: [], leave: [], off: [],
  }
  for (const agent of agents) {
    const slot = slotMap.get(`${agent.id}:${todayIso}`)
    const status: AttendanceStatus = !slot || slot.effectiveStatus === 'no_rotation' ? 'off' : slot.effectiveStatus
    buckets[status].push(agent)
  }

  const leadersOnShift = leaders.filter(leader => {
    const record = attendanceRecords.find(r => r.profile_id === leader.id)
    return !record || record.status === 'on_shift'
  })

  const totalStaff = agents.length + leaders.length

  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">Total Staff</p>
        <p className="text-lg font-bold text-gray-900 dark:text-white">{totalStaff}</p>
      </div>

      <div className="space-y-1.5">
        {AGENT_CATEGORIES.map(status => (
          <AttendanceCategoryRow
            key={status}
            label={statusLabels[status]}
            colorClasses={statusColorClasses[status]}
            people={buckets[status]}
          />
        ))}
      </div>

      <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
        <AttendanceCategoryRow
          label="Team Leaders on Shift"
          colorClasses={statusColorClasses.on_shift}
          people={leadersOnShift}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors (Task 2's single expected error is now resolved).

Manual check, `npm run dev`, logged in as `management`:
1. Open the Management console window on the dashboard. Confirm it shows a "Total Staff" number and six rows (On Shift / Late / Absent / Sick / Leave / Off), plus a "Team Leaders on Shift" row below a divider.
2. Cross-check every count against the Roster page's day view for today, for the same agents — they must match exactly, since both read through `resolveShift`.
3. Expand a non-empty category — confirm it lists the correct agent names, matching the Roster page for that same status.
4. Confirm `Total Staff` equals the number of active agents plus active team leaders (cross-check with a direct count of `profiles` where `role = 'agent' AND is_active = true`, plus active team leaders).
5. Log in as `admin`: confirm the Management console window does not appear at all (unchanged from before this feature — `windowConfig.ts` only adds it for `management`).
6. Log in as `agent`: confirm the dashboard is unaffected (plain `DashboardContent`, no console desktop at all).

Report exact observed counts/names, not just "it matched."

- [ ] **Step 4: Commit**

```bash
git add components/console/AttendanceCategoryRow.tsx components/console/ManagementConsole.tsx
git commit -m "feat: render live attendance summary in the Management console"
```

---

### Task 4: Full manual QA pass

**Files:** none (verification only — if QA finds a bug, fix it in the relevant file and commit that fix separately with a clear message).

**Interfaces:** N/A.

- [ ] **Step 1: Confirm the `no_rotation` → "Off" folding**

Find (or temporarily create, then revert) an active agent with no `team_members` row, or whose team has no `team_rotations` entry for the current week. Confirm they appear under **Off** in the Management console (not silently dropped from any category, and still counted in Total Staff).

- [ ] **Step 2: Confirm RLS boundaries end-to-end, not just via direct API calls**

While logged in as `management` in the browser, confirm the console renders real data (already covered in Task 3) — this is the positive case. Then mint an `agent` JWT (same technique as Task 1) and directly query `attendance_records` and `roster_overrides` for a profile that is not that agent — confirm both are still blocked (empty result), proving Task 1's widening did not accidentally loosen access beyond `management`.

- [ ] **Step 3: Small-window layout check**

Resize the Management console window (using the corner-resize feature already in place) down to a small size and up to a large size. Confirm the category list scrolls within the window rather than overflowing it, and that expanding a category doesn't visually break the layout at either size.

- [ ] **Step 4: Final commit (only if QA fixes were made)**

If Steps 1-3 required any code fixes, commit each individually with a message describing the specific bug fixed. If everything passed with no fixes needed, say so clearly.

---

## Plan Self-Review

**Spec coverage:** RLS widening for `management` read access (Task 1), live data fetch reusing `resolveShift`/`buildSlotMap` (Task 2), six-category agent breakdown + Team Leaders on Shift + Total Staff UI reusing `statusColorClasses`/`statusLabels` (Task 3), `no_rotation`→"Off" folding and RLS-boundary verification (Task 4) — every element of the approved design doc (`docs/superpowers/specs/2026-08-08-management-console-attendance-design.md`) is covered: data/computation approach, the two widened RLS policies, the "today only" scope, and the layout (Total Staff header + 6 collapsible category rows + Team Leaders on Shift row).

**Placeholder scan:** No TBD/TODO markers. Task 2's expected single tsc error (missing `ManagementConsoleProps` export) is a disclosed, intentional mid-plan state — identical in kind to the precedent used for `app/(app)/team-leaders/page.tsx` in the Team Leaders Management plan — not a silent placeholder, and it's resolved by Task 3.

**Type consistency:** The `managementData` object shape defined in Task 2's "Produces" section matches `ManagementConsoleProps` in Task 3 field-for-field (`agents`, `teamMembers`, `teamRotations`, `attendanceRecords`, `rosterOverrides`, `leaders`, `todayIso`). `PersonLite` is used consistently for both `agents` and `leaders`. `AttendanceCategoryRowProps.people` matches how `ManagementConsole` calls it (`PersonLite[]` in both places, name-for-name).
