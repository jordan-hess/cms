# Management Dashboard Per-Team-Leader Consoles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace management's post-login dashboard "Teamleaders"/"Agents" windows (currently identical self-scoped agent-style stat tiles, duplicated) with one console per team leader showing that team's agents' aggregated activity — total customers, pending callbacks, open follow-ups, unread alerts. Agent and admin dashboards must stay pixel-for-pixel unchanged.

**Architecture:** A new `ConsoleKind` (`'teamleader-overview'`) and a new content component are added alongside the existing console system, used only by management's window config — admin's existing `'teamleader'`/`'agents'` kinds and their components are never touched. Data is derived (not stored): every dashboard load re-reads `team_leaders`/`team_members` (already fetched for the existing Management/roster console) and bulk-fetches customers/callbacks/followups/notifications scoped to the union of every team's agent ids, then groups counts by team client-side.

**Tech Stack:** Next.js 16 App Router (async Server Components), Supabase Postgres + RLS, TypeScript, Tailwind, `lucide-react` icons.

## Global Constraints

- No automated test suite exists in this project (per `CLAUDE.md`) — verification is `npx tsc --noEmit` after every task plus a final manual QA pass.
- `agent` and `admin` dashboards must be provably unaffected — every change either lives in a new file, or is additive to a file admin/agent code paths don't read (a new optional prop, a new switch case, a new array element only pushed for `role === 'management'`). Never modify the existing `'teamleader'`/`'agents'` `ConsoleKind` cases, `TeamleadersConsole.tsx`, or `AgentsConsole.tsx`.
- Reuse the already-fetched `team_leaders`/`team_members` arrays in `app/(app)/dashboard/page.tsx`'s existing `management`-only block — do not issue a second, duplicate fetch of either table.
- Bulk-fetch-then-group: the 4 new aggregate queries (customers/callbacks/followups/notifications) must each run once, scoped with `.in(<column>, allAgentIds)` across every team at once — never one query per team.
- `callbacks` RLS must be widened for `management` (it is not today, unlike `customers`/`followups`) or the "Pending Callbacks" stat will silently always read 0.

---

### Task 1: RLS migration — management can read all callbacks

**Files:**
- Create: `supabase/migrations/management-callbacks-access.sql`

**Interfaces:**
- Produces: widened SELECT policy on `callbacks`, granting `role = 'management'` the same unscoped read access `role = 'admin'` already has. No other policy on `callbacks` changes.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/management-callbacks-access.sql` with this exact content:

```sql
-- ============================================================
-- Widen the callbacks SELECT policy so 'management' can read
-- every agent's callbacks — needed for the management dashboard's
-- per-team-leader "Pending Callbacks" stat. Mirrors the exact
-- pattern already used for followups
-- (management-followups-access.sql).
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — RLS policy is dropped/recreated,
-- no data changes.
-- ============================================================

DROP POLICY IF EXISTS "Agents see their own callbacks" ON callbacks;
CREATE POLICY "Agents see their own callbacks" ON callbacks FOR SELECT TO authenticated USING (
  agent_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
);
```

Do not touch the `"Users can insert callbacks"` or `"Agents can update their callbacks"` policies — this feature only reads aggregate counts, never writes.

- [ ] **Step 2: Ask the human to run the migration live**

This project has no migration runner — every `supabase/migrations/*.sql` file is applied by hand in the Supabase SQL Editor. Ask the human partner to run this file, then confirm it completes with no errors before continuing.

- [ ] **Step 3: Verify the policy**

Ask the human to confirm via:
```sql
SELECT policyname, qual FROM pg_policies WHERE tablename = 'callbacks' AND policyname = 'Agents see their own callbacks';
```
Expect the `qual` text to include `role = ANY (ARRAY['admin'::text, 'management'::text])` or equivalent (the exact rendering of `role IN ('admin','management')` once Postgres normalizes it) — confirm `'management'` appears somewhere in the returned text, not just `'admin'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/management-callbacks-access.sql
git commit -m "feat: let management read all agents' callbacks"
```

---

### Task 2: Types — `TeamLeaderConsoleData`

**Files:**
- Modify: `types/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TeamLeaderConsoleData {
    teamId: string
    teamName: string
    teamColor: TeamColor
    leaderName: string
    totalCustomers: number
    pendingCallbacks: number
    openFollowups: number
    unreadAlerts: number
  }
  ```
- Consumes: the existing `TeamColor` type (`'green' | 'blue' | 'red' | 'yellow'`, already defined in this same file — confirm its exact location and do not redefine it).

- [ ] **Step 1: Add the type**

Add near the existing `Team`/`TeamMember` block in `types/index.ts` (the `TeamColor` type is already defined a few lines above — this new interface goes after `Team`/`TeamMember`, not before, since it doesn't need to precede its own dependency but reads more naturally grouped with the other team-related types):

```ts
/** One management-dashboard console: a team leader's team's aggregated agent activity */
export interface TeamLeaderConsoleData {
  teamId: string
  teamName: string
  teamColor: TeamColor
  leaderName: string
  totalCustomers: number
  pendingCallbacks: number
  openFollowups: number
  unreadAlerts: number
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add TeamLeaderConsoleData type"
```

---

### Task 3: New `ConsoleKind` + management-only window config

**Files:**
- Modify: `components/console/types.ts`
- Modify: `components/console/windowConfig.ts`

**Interfaces:**
- Produces: `ConsoleKind` gains `'teamleader-overview'`. `getWindowConfigs('management')` now returns a different window set (no `agents-*`, one `teamleaders-overview` window instead of two `teamleader-*`). `getWindowConfigs('admin')` is unchanged.

- [ ] **Step 1: Add the new `ConsoleKind` value**

In `components/console/types.ts`, change line 1 from:

```ts
export type ConsoleKind = 'teamleader' | 'agents' | 'management'
```

to:

```ts
export type ConsoleKind = 'teamleader' | 'agents' | 'management' | 'teamleader-overview'
```

Nothing else in this file changes — `WindowConfig`/`WindowState` interfaces are untouched.

- [ ] **Step 2: Change management's window set**

In `components/console/windowConfig.ts`, replace the full file with:

```ts
import { WindowConfig, WindowState } from './types'

export function getWindowConfigs(role: 'admin' | 'management'): WindowConfig[] {
  if (role === 'management') {
    return [
      { id: 'teamleaders-overview', kind: 'teamleader-overview', title: 'Team Leaders', defaultX: 40, defaultY: 32, defaultWidth: 900, defaultHeight: 640, entryDelayMs: 0 },
      { id: 'management', kind: 'management', title: 'Management', defaultX: 960, defaultY: 32, defaultWidth: 480, defaultHeight: 360, entryDelayMs: 80 },
    ]
  }

  return [
    { id: 'teamleader-1', kind: 'teamleader', title: 'Teamleaders', defaultX: 40, defaultY: 32, defaultWidth: 560, defaultHeight: 420, entryDelayMs: 0 },
    { id: 'teamleader-2', kind: 'teamleader', title: 'Teamleaders', defaultX: 620, defaultY: 32, defaultWidth: 560, defaultHeight: 420, entryDelayMs: 40 },
    { id: 'agents-1', kind: 'agents', title: 'Agents', defaultX: 40, defaultY: 480, defaultWidth: 400, defaultHeight: 320, entryDelayMs: 80 },
    { id: 'agents-2', kind: 'agents', title: 'Agents', defaultX: 460, defaultY: 480, defaultWidth: 400, defaultHeight: 320, entryDelayMs: 120 },
  ]
}

export function buildInitialWindowStates(role: 'admin' | 'management'): WindowState[] {
  return getWindowConfigs(role).map((config, index) => ({
    ...config,
    x: config.defaultX,
    y: config.defaultY,
    width: config.defaultWidth,
    height: config.defaultHeight,
    zIndex: index + 1,
    status: 'open' as const,
  }))
}
```

Note: `getWindowConfigs('admin')`'s returned array is byte-for-byte identical in content to today's admin branch of the original function (same 4 entries, same ids/positions/sizes) — only the code structure changed (an early return for management instead of a shared array both branches mutate), so admin's rendered output is unaffected. `buildInitialWindowStates` is completely unchanged.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: an error in `components/console/ConsoleDesktop.tsx`'s `renderConsole` switch, because it doesn't yet handle the new `'teamleader-overview'` kind (TypeScript's exhaustiveness checking on the switch, if the function has a return-type annotation forcing all cases to return — check whether this actually surfaces as an error; if `renderConsole` has no explicit return type requiring exhaustiveness, there may be NO error here, just a `'teamleader-overview'` case that falls through to `undefined` at runtime for now). Either way, confirm there are no OTHER, unexpected errors — Task 5 (ConsoleDesktop wiring) is what actually completes this.

- [ ] **Step 4: Commit**

```bash
git add components/console/types.ts components/console/windowConfig.ts
git commit -m "feat: add teamleader-overview console kind and management window set"
```

---

### Task 4: New `TeamLeaderOverviewConsole` component

**Files:**
- Create: `components/console/TeamLeaderOverviewConsole.tsx`

**Interfaces:**
- Consumes: `TeamLeaderConsoleData` type (Task 2), `teamColorClasses` from `@/lib/roster/teamColors` (existing, already used by `TeamRequestsBody.tsx` — do not modify it).
- Produces: default export `TeamLeaderOverviewConsole({ consoles: TeamLeaderConsoleData[] })`, consumed by `components/console/ConsoleDesktop.tsx` (Task 5).

- [ ] **Step 1: Create `components/console/TeamLeaderOverviewConsole.tsx`**

```tsx
'use client'

import { TeamLeaderConsoleData } from '@/types'
import { teamColorClasses } from '@/lib/roster/teamColors'
import { Users, Phone, FileText, AlertTriangle } from 'lucide-react'

interface Props {
  consoles: TeamLeaderConsoleData[]
}

const tileCls = 'bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-800'

export default function TeamLeaderOverviewConsole({ consoles }: Props) {
  if (consoles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
          No team leaders yet — consoles appear here once a team and its leader are set up.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {consoles.map(c => {
          const colors = teamColorClasses[c.teamColor]
          return (
            <div key={c.teamId} className="bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-100 dark:border-gray-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                <p className="font-semibold text-gray-900 dark:text-white text-sm">{c.teamName}</p>
                <span className="text-xs text-gray-500 dark:text-gray-400">· {c.leaderName}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className={tileCls}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Users className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-lg font-bold text-gray-900 dark:text-white">{c.totalCustomers}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">Total Customers</p>
                </div>
                <div className={tileCls}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Phone className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-lg font-bold text-gray-900 dark:text-white">{c.pendingCallbacks}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">Pending Callbacks</p>
                </div>
                <div className={tileCls}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <FileText className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-lg font-bold text-gray-900 dark:text-white">{c.openFollowups}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">Open Follow-ups</p>
                </div>
                <div className={tileCls}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-lg font-bold text-gray-900 dark:text-white">{c.unreadAlerts}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">Unread Alerts</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors (this component isn't wired into `ConsoleDesktop` yet — Task 5 does that — but it has no dependency on anything unbuilt, so it should compile cleanly on its own).

- [ ] **Step 3: Commit**

```bash
git add components/console/TeamLeaderOverviewConsole.tsx
git commit -m "feat: add TeamLeaderOverviewConsole component"
```

---

### Task 5: Wire the new kind into `ConsoleDesktop.tsx`

**Files:**
- Modify: `components/console/ConsoleDesktop.tsx`

**Interfaces:**
- Consumes: `TeamLeaderOverviewConsole` (Task 4), `TeamLeaderConsoleData` type (Task 2).
- Produces: `ConsoleDesktopProps` gains `teamLeaderConsoles?: TeamLeaderConsoleData[]`, consumed by `app/(app)/dashboard/page.tsx` (Task 6).

- [ ] **Step 1: Add the import and prop**

In `components/console/ConsoleDesktop.tsx`, add this import alongside the existing console component imports:

```tsx
import TeamLeaderOverviewConsole from './TeamLeaderOverviewConsole'
```

Add this import alongside the existing type imports:

```tsx
import { TeamLeaderConsoleData } from '@/types'
```

Change the `ConsoleDesktopProps` interface from:

```tsx
export interface ConsoleDesktopProps {
  role: 'admin' | 'management'
  dashboardData: DashboardContentProps
  managementData?: ManagementConsoleProps
}
```

to:

```tsx
export interface ConsoleDesktopProps {
  role: 'admin' | 'management'
  dashboardData: DashboardContentProps
  managementData?: ManagementConsoleProps
  teamLeaderConsoles?: TeamLeaderConsoleData[]
}
```

Change the component's destructured props from:

```tsx
export default function ConsoleDesktop({ role, dashboardData, managementData }: ConsoleDesktopProps) {
```

to:

```tsx
export default function ConsoleDesktop({ role, dashboardData, managementData, teamLeaderConsoles }: ConsoleDesktopProps) {
```

- [ ] **Step 2: Add the new render case**

Change `renderConsole` from:

```tsx
  function renderConsole(w: WindowState) {
    switch (w.kind) {
      case 'teamleader':
        return <TeamleadersConsole {...dashboardData} />
      case 'agents':
        return <AgentsConsole />
      case 'management':
        return managementData ? <ManagementConsole {...managementData} /> : null
    }
  }
```

to:

```tsx
  function renderConsole(w: WindowState) {
    switch (w.kind) {
      case 'teamleader':
        return <TeamleadersConsole {...dashboardData} />
      case 'agents':
        return <AgentsConsole />
      case 'management':
        return managementData ? <ManagementConsole {...managementData} /> : null
      case 'teamleader-overview':
        return <TeamLeaderOverviewConsole consoles={teamLeaderConsoles ?? []} />
    }
  }
```

Do not touch the `'teamleader'`, `'agents'`, or `'management'` cases — they are byte-for-byte unchanged, so `admin`'s rendering (which only ever produces windows of those three kinds, per Task 3's unchanged `getWindowConfigs('admin')`) is unaffected.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add components/console/ConsoleDesktop.tsx
git commit -m "feat: wire teamleader-overview console kind into ConsoleDesktop"
```

---

### Task 6: Page query — aggregate per-team-leader stats in `app/(app)/dashboard/page.tsx`

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `TeamLeaderConsoleData` type (Task 2), `ConsoleDesktop`'s new `teamLeaderConsoles` prop (Task 5).
- Produces: nothing consumed by a later task — this is the last wiring point.

- [ ] **Step 1: Add the import**

Change the existing type import line from:

```tsx
import { AttendanceRecord, RosterOverride } from '@/types'
```

to:

```tsx
import { AttendanceRecord, RosterOverride, TeamLeaderConsoleData } from '@/types'
```

- [ ] **Step 2: Declare `teamLeaderConsoles` and extend the `team_leaders` query**

Inside the `if (profile?.role === 'admin' || profile?.role === 'management')` block, change:

```tsx
  if (profile?.role === 'admin' || profile?.role === 'management') {
    let managementData
    if (profile.role === 'management') {
```

to:

```tsx
  if (profile?.role === 'admin' || profile?.role === 'management') {
    let managementData
    let teamLeaderConsoles: TeamLeaderConsoleData[] = []
    if (profile.role === 'management') {
```

Then, within that same `if (profile.role === 'management')` block, change the `team_leaders` line inside the existing `Promise.all` — from:

```tsx
        supabase.from('team_leaders').select('id, profile_id, profiles!team_leaders_profile_id_fkey(id, full_name, is_active)'),
```

to:

```tsx
        supabase.from('team_leaders').select('id, profile_id, team_id, teams(id, name, color), profiles!team_leaders_profile_id_fkey(id, full_name, is_active)'),
```

This adds `team_id` and the embedded `teams(id, name, color)` to the SAME query that already fetches team leaders for the roster/attendance console — no new query, no new round trip. Everything else in that `Promise.all` (the 5 other queries, and the destructured `{ data: teamLeaders, error: teamLeadersErr }` variable name) is unchanged.

- [ ] **Step 3: Add the aggregation block**

Immediately after the existing `leaders.sort(...)` line (the last line of the existing `leaders` computation, right before `managementData = {`), insert:

```tsx
      // Per-team-leader dashboard console aggregates — reuses teamMembers/teamLeaders
      // already fetched above, adds 4 bulk queries scoped to every team's agents at once.
      const membersByTeam = new Map<string, string[]>()
      for (const tm of teamMembers || []) {
        const list = membersByTeam.get(tm.team_id) ?? []
        list.push(tm.profile_id)
        membersByTeam.set(tm.team_id, list)
      }
      const allAgentIds = [...new Set((teamMembers || []).map(tm => tm.profile_id))]

      const [
        { data: allCustomers, error: allCustomersErr },
        { data: allCallbacks, error: allCallbacksErr },
        { data: allFollowups, error: allFollowupsErr },
        { data: allNotifications, error: allNotificationsErr },
      ] = allAgentIds.length
        ? await Promise.all([
            supabase.from('customers').select('id, created_by').in('created_by', allAgentIds),
            supabase.from('callbacks').select('id, agent_id').eq('status', 'pending').in('agent_id', allAgentIds),
            supabase.from('followups').select('id, agent_id').in('status', ['open', 'in_progress']).in('agent_id', allAgentIds),
            supabase.from('notifications').select('id, recipient_id').eq('read', false).in('recipient_id', allAgentIds),
          ])
        : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }]

      if (allCustomersErr) console.error('[dashboard] failed to fetch customers for team leader consoles:', allCustomersErr)
      if (allCallbacksErr) console.error('[dashboard] failed to fetch callbacks for team leader consoles:', allCallbacksErr)
      if (allFollowupsErr) console.error('[dashboard] failed to fetch followups for team leader consoles:', allFollowupsErr)
      if (allNotificationsErr) console.error('[dashboard] failed to fetch notifications for team leader consoles:', allNotificationsErr)

      teamLeaderConsoles = (teamLeaders || [])
        .filter((tl: any) => tl.profiles?.is_active)
        .map((tl: any) => {
          const agentIds = membersByTeam.get(tl.team_id) ?? []
          const inTeam = (id: string) => agentIds.includes(id)
          return {
            teamId: tl.team_id,
            teamName: tl.teams?.name ?? 'Unknown Team',
            teamColor: tl.teams?.color ?? 'blue',
            leaderName: tl.profiles?.full_name ?? 'Unknown',
            totalCustomers: (allCustomers || []).filter((c: any) => inTeam(c.created_by)).length,
            pendingCallbacks: (allCallbacks || []).filter((c: any) => inTeam(c.agent_id)).length,
            openFollowups: (allFollowups || []).filter((f: any) => inTeam(f.agent_id)).length,
            unreadAlerts: (allNotifications || []).filter((n: any) => inTeam(n.recipient_id)).length,
          }
        })

```

`.filter((tl: any) => tl.profiles?.is_active)` matches the existing `leaders` computation a few lines above, which applies the identical `is_active` filter — a deactivated team leader shouldn't get a console any more than they'd appear in the roster console's own leader list.

- [ ] **Step 4: Pass the new prop to `ConsoleDesktop`**

Change:

```tsx
    return (
      <div className="h-full">
        <ConsoleDesktop
          role={profile.role}
          dashboardData={{ stats, pendingCallbacks, openFollowups, urgentFollowups }}
          managementData={managementData}
        />
      </div>
    )
```

to:

```tsx
    return (
      <div className="h-full">
        <ConsoleDesktop
          role={profile.role}
          dashboardData={{ stats, pendingCallbacks, openFollowups, urgentFollowups }}
          managementData={managementData}
          teamLeaderConsoles={teamLeaderConsoles}
        />
      </div>
    )
```

For `admin`, `teamLeaderConsoles` is always `[]` (declared but never populated, since the aggregation block only runs inside `if (profile.role === 'management')`) — harmless, since `admin`'s window config (Task 3) never produces a `'teamleader-overview'`-kind window that would consume it.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors — this completes the full chain from migration through UI.

- [ ] **Step 6: Manual smoke test**

Start the dev server (`npm run dev`) and confirm `/dashboard` compiles and serves without a server-side error for at least one authenticated session. Full multi-role interactive verification happens in Task 7.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/dashboard/page.tsx"
git commit -m "feat: aggregate per-team-leader dashboard console stats"
```

---

### Task 7: Full manual QA pass

**Files:** none (verification only).

- [ ] **Step 1: Regression check — agent and admin unchanged**

Log in as `agent`: confirm the Dashboard is pixel-for-pixel unchanged (still the plain 4-tile `DashboardContent`, no `ConsoleDesktop`). Log in as `admin`: confirm the Dashboard still shows the two duplicate "Teamleaders" windows and two duplicate "Agents" windows, each rendering exactly as before — same self-scoped stats, same placeholder "Agents" content, same positions/sizes.

- [ ] **Step 2: Management's new console layout**

Log in as `management`: confirm the "Agents" windows are gone, there's a single "Team Leaders" window (not two), and it renders one card per existing team leader with 4 stat tiles each. Confirm the roster/attendance "Management" window still renders correctly alongside it, completely unaffected.

- [ ] **Step 3: Stat accuracy via minted sessions or direct DB queries**

Using the minted-JWT-against-PostgREST technique used for prior features in this project (a script exists in this session's scratchpad directory — reconstruct it if no longer present: sign an HS256 JWT with `SUPABASE_JWT_SECRET` from `.env.local`, `role: 'authenticated'`, `sub: <profile-uuid>`, using the `jose` package's `SignJWT`) or the Supabase Dashboard's table editor directly:
- Pick a specific team leader and one of their agents. Create a customer with `created_by` = that agent, a callback with `agent_id` = that agent and `status = 'pending'`, a followup with `agent_id` = that agent and `status = 'open'`, and a notification with `recipient_id` = that agent and `read = false`.
- Refresh management's dashboard. Confirm that team leader's card's 4 numbers each increased by exactly 1.
- Confirm NO other team leader's card changed.
- Confirm the RLS widening actually matters: without Task 1's migration, the "Pending Callbacks" number would have stayed 0 regardless of this test data — if you can, temporarily verify this old behavior would have been wrong is not necessary if Task 1 already passed its own verification; this step is about confirming the END-TO-END number is correct now.

- [ ] **Step 4: Edge cases**

Confirm a team leader whose team currently has zero agents shows a card with all four stats at 0 (not an error, not a missing card). If there's any way to test with zero team leaders (e.g., a test/staging database), confirm the empty-state message renders instead of a blank window.

- [ ] **Step 5: Clean up test data**

Delete any test customer/callback/followup/notification rows created in Step 3, confirm gone via a follow-up query.

No commit for this task — it's verification only. If any step reveals a genuine bug, fix it as a normal follow-up commit on this branch before calling the plan complete.
