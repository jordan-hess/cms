# Team Leaders Management Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `management`-role users a drag-and-drop board (replacing their "Callbacks" nav entry) where they can see every team's members and leader, move people between teams, promote an agent to team leader by dropping them into a leader slot, add unassigned people to a team, edit a person's profile, and deactivate someone.

**Architecture:** Widen 8 existing admin-only RLS policies (`profiles`, `team_members`, `team_leaders`) to also accept `management`. New route `/team-leaders`, gated to `management` in both `proxy.ts` and a page-level layout guard. A server component does flat parallel fetches (no RPCs/views); a client "board" component owns a `@dnd-kit/core` `DndContext`, derives per-team view-models, and performs all mutations directly via the browser Supabase client, following this codebase's established data-fetching convention (see `app/(app)/coaching/` for the most recent precedent).

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), `@dnd-kit/core` + `@dnd-kit/utilities` (new dependency — no drag-and-drop library exists in this codebase today), Tailwind, `lucide-react`.

## Global Constraints

- No automated test suite exists in this project (confirmed in `CLAUDE.md`) — every task's "verify" step is a manual/live check, consistent with how every other feature in this codebase has been verified.
- All `profiles(...)` selects/embeds MUST use explicit column lists — never `select('*')`. This codebase had a real incident (bcrypt hashes leaking into RSC payloads) from that exact pattern; it was fixed everywhere and must not be reintroduced.
- `team_leaders` has TWO foreign keys to `profiles` (`profile_id`, `assigned_by`) — any PostgREST embed of `profiles` through `team_leaders` MUST be qualified as `profiles!team_leaders_profile_id_fkey(...)` or PostgREST returns an error instead of rows. This exact bug was hit and fixed while building `app/(app)/coaching/page.tsx` earlier this session — do not reintroduce it.
- All mutations happen via the browser Supabase client directly (`lib/supabase/client.ts`) inside `'use client'` components, followed by `router.refresh()` — no new API routes, no RPCs. This matches every existing manager component in this codebase (`CustomerManager`, `AgentManager`, `CoachingManager`, etc.).
- `/callbacks` itself is NOT gated and NOT modified — only the Sidebar nav link and `management`'s own usage pattern change. Agents and admins must see `/callbacks` completely unaffected (same precedent as the earlier Customers→Coaching swap, which left `/customers` untouched).
- The existing DB trigger `enforce_team_leader_is_admin()` (in `supabase/team-leaders-schema.sql`) is NOT modified — it still requires any `team_leaders.profile_id` to be `role = 'admin'`. The UI satisfies this by promoting a person to `admin` before assigning them as a leader, never by changing the trigger.

---

### Task 1: RLS migration — widen admin-only write policies to include `management`

**Files:**
- Create: `supabase/migrations/management-team-write-access.sql`

**Interfaces:**
- Consumes: nothing new.
- Produces: a live database change. After this task, a `management`-role authenticated session can `UPDATE`/`INSERT` on `profiles`, and `INSERT`/`UPDATE`/`DELETE` on `team_members` and `team_leaders`. An `agent`-role session must still be rejected by all of these.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/management-team-write-access.sql`:

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

- [ ] **Step 2: Run it live**

Run this file's contents in the Supabase SQL Editor.

- [ ] **Step 3: Verify live**

Using the service-role client, confirm the 8 policies now read `role IN ('admin', 'management')` (query `pg_policies` or re-read them via the SQL Editor). Then, using a real `management` session's minted JWT (same technique as this session's earlier RLS verification: mint via `/api/auth/supabase-token` after logging in, then use the anon key + that JWT), attempt a real write to each of `profiles` (update `department` on some test row), `team_members` (upsert a row), and `team_leaders` (upsert a row) — all three must succeed. Then repeat with an `agent` session's JWT — all three must be rejected with an RLS error. Revert any test writes afterward.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/management-team-write-access.sql
git commit -m "feat: widen admin-only RLS policies to also allow management role"
```

---

### Task 2: Types + query layer

**Files:**
- Modify: `types/index.ts`
- Create: `app/(app)/team-leaders/layout.tsx`
- Create: `app/(app)/team-leaders/page.tsx`

**Interfaces:**
- Consumes: `Team`, `TeamMember`, `TeamLeader`, `Profile`, `Role` (all already exist in `types/index.ts`); `createClient` from `@/lib/supabase/server`; `getCurrentUserId` from `@/lib/auth/getCurrentUserId`; `Header` from `@/components/layout/Header`.
- Produces: `TeamBoardColumn` type; the page passes `{ teams, teamMembers, teamLeaders, allProfiles, currentUserId }` to `TeamLeadersBoard` (built in Task 3).

- [ ] **Step 1: Add the `TeamBoardColumn` type**

In `types/index.ts`, after the `RequestWithDetail` interface at the end of the file, add:

```ts
// ─── Team Leaders Management (board view-model) ────────────────────────────────

/** Computed client-side board-column view-model, one per team */
export interface TeamBoardColumn {
  team: Team
  leader: (Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'> & { teamLeaderRowId: string }) | null
  members: Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>[]
}
```

- [ ] **Step 2: Add the role-gate layout**

Create `app/(app)/team-leaders/layout.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { redirect } from 'next/navigation'

export default async function TeamLeadersLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId!).single()

  if (profile?.role !== 'management') redirect('/dashboard')

  return <>{children}</>
}
```

- [ ] **Step 3: Add the page**

Create `app/(app)/team-leaders/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import TeamLeadersBoard from '@/components/team-leaders/TeamLeadersBoard'

export default async function TeamLeadersPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  const [
    { data: teams },
    { data: teamMembers },
    { data: teamLeaders },
    { data: allProfiles },
  ] = await Promise.all([
    supabase.from('teams').select('id, name, color, description').order('name'),
    supabase.from('team_members').select('id, team_id, profile_id, joined_at, profiles(id, full_name, email, role, department, is_active)'),
    // team_leaders has two FKs to profiles (profile_id, assigned_by) — the embed
    // must be qualified or PostgREST returns an error instead of rows (see
    // app/(app)/coaching/page.tsx for the same pattern/reason).
    supabase.from('team_leaders').select('id, team_id, profile_id, assigned_by, created_at, profiles!team_leaders_profile_id_fkey(id, full_name, email, role, department, is_active)'),
    supabase.from('profiles').select('id, full_name, email, role, department, is_active').eq('is_active', true),
  ])

  return (
    <div>
      <Header title="Team Leaders Management" userId={userId!} />
      <div className="p-6">
        <TeamLeadersBoard
          teams={teams || []}
          teamMembers={teamMembers || []}
          teamLeaders={teamLeaders || []}
          allProfiles={allProfiles || []}
          currentUserId={userId!}
        />
      </div>
    </div>
  )
}
```

(This will fail to compile until Task 3 creates `TeamLeadersBoard` — that's expected and resolved by the next task, matching how this plan's tasks build on each other.)

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit` — expect exactly one error, `Cannot find module '@/components/team-leaders/TeamLeadersBoard'`, confirming everything else type-checks. No other errors.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts "app/(app)/team-leaders/layout.tsx" "app/(app)/team-leaders/page.tsx"
git commit -m "feat: add types and data-fetching layer for Team Leaders Management page"
```

---

### Task 3: Read-only board — `TeamLeadersBoard`, `TeamColumn`, `PersonCard`

**Files:**
- Create: `components/team-leaders/TeamLeadersBoard.tsx`
- Create: `components/team-leaders/TeamColumn.tsx`
- Create: `components/team-leaders/PersonCard.tsx`

**Interfaces:**
- Consumes: `TeamBoardColumn`, `Team`, `TeamMember`, `TeamLeader`, `Profile`, `Role` from `@/types`; `teamColorClasses` from `@/lib/roster/teamColors` (already used identically in `components/roster/admin/AssignTeamLeaderModal.tsx`).
- Produces: `TeamLeadersBoard` — the default export `page.tsx` (Task 2) imports. No drag-and-drop yet in this task — cards render but aren't draggable, columns render but aren't droppable. This task is a pure visual/layout pass; Task 4 adds interactivity.

- [ ] **Step 1: Add `PersonCard` (static, no drag yet)**

Create `components/team-leaders/PersonCard.tsx`:

```tsx
'use client'

import { Pencil, UserX } from 'lucide-react'
import { Profile } from '@/types'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  person: PersonLite
  isLeader: boolean
  onEdit: (person: PersonLite) => void
  onDeactivate: (personId: string) => void
}

export default function PersonCard({ person, isLeader, onEdit, onDeactivate }: Props) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        isLeader
          ? 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20'
          : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900'
      } ${!person.is_active ? 'opacity-50' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{person.full_name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {person.department || person.role}
          {!person.is_active && ' · inactive'}
        </p>
      </div>
      <button type="button" onClick={() => onEdit(person)} className="p-1 text-gray-400 hover:text-blue-600 shrink-0">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={() => onDeactivate(person.id)} className="p-1 text-gray-400 hover:text-red-600 shrink-0">
        <UserX className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add `TeamColumn` (static, no drop zones yet)**

Create `components/team-leaders/TeamColumn.tsx`:

```tsx
'use client'

import { Plus, Crown } from 'lucide-react'
import { TeamBoardColumn, Profile } from '@/types'
import PersonCard from './PersonCard'
import { teamColorClasses } from '@/lib/roster/teamColors'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  column: TeamBoardColumn
  onEdit: (person: PersonLite) => void
  onDeactivate: (personId: string) => void
  onAdd: (teamId: string) => void
}

export default function TeamColumn({ column, onEdit, onDeactivate, onAdd }: Props) {
  const { team, leader, members } = column
  const c = teamColorClasses[team.color]

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col w-72 shrink-0">
      <div className={`px-4 py-3 rounded-t-xl border-b ${c.border} ${c.lightBg}`}>
        <p className={`font-semibold text-sm ${c.text}`}>{team.name}</p>
      </div>

      <div className="p-3 space-y-2">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
          <Crown className="w-3 h-3" /> Leader
        </p>
        <div className="min-h-[52px] rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 p-1">
          {leader ? (
            <PersonCard person={leader} isLeader onEdit={onEdit} onDeactivate={onDeactivate} />
          ) : (
            <p className="text-xs text-gray-400 text-center py-3">No leader assigned</p>
          )}
        </div>
      </div>

      <div className="px-3 pb-3 flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Members ({members.length})</p>
          <button type="button" onClick={() => onAdd(team.id)} className="text-gray-400 hover:text-blue-600">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="min-h-[80px] rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 p-1 space-y-1.5">
          {members.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No members</p>
          ) : (
            members.map(m => (
              <PersonCard key={m.id} person={m} isLeader={false} onEdit={onEdit} onDeactivate={onDeactivate} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add `TeamLeadersBoard` (derives columns, no mutations/modals yet)**

Create `components/team-leaders/TeamLeadersBoard.tsx`:

```tsx
'use client'

import { Team, TeamMember, TeamLeader, Profile, TeamBoardColumn } from '@/types'
import TeamColumn from './TeamColumn'

type ProfileLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>
type TeamMemberRow = TeamMember & { profiles?: ProfileLite }
type TeamLeaderRow = TeamLeader & { profiles?: ProfileLite }

interface Props {
  teams: Team[]
  teamMembers: TeamMemberRow[]
  teamLeaders: TeamLeaderRow[]
  allProfiles: ProfileLite[]
  currentUserId: string
}

export default function TeamLeadersBoard({ teams, teamMembers, teamLeaders }: Props) {
  const columns: TeamBoardColumn[] = teams.map(team => {
    const leaderRow = teamLeaders.find(tl => tl.team_id === team.id)
    const leader = leaderRow?.profiles ? { ...leaderRow.profiles, teamLeaderRowId: leaderRow.id } : null
    const members = teamMembers
      .filter(tm => tm.team_id === team.id && tm.profile_id !== leader?.id)
      .map(tm => tm.profiles)
      .filter((p): p is ProfileLite => p != null)
    return { team, leader, members }
  })

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map(column => (
        <TeamColumn
          key={column.team.id}
          column={column}
          onEdit={() => {}}
          onDeactivate={() => {}}
          onAdd={() => {}}
        />
      ))}
    </div>
  )
}
```

(`allProfiles`/`currentUserId` props and the no-op handlers are intentionally unused/placeholder in this task — Task 4 and Task 5 wire them up. This is expected mid-plan state, not a defect.)

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors. Note: `TeamLeadersBoard`'s destructured parameters (`{ teams, teamMembers, teamLeaders }: Props`) deliberately omit `allProfiles`/`currentUserId` even though `Props` declares them — TypeScript permits destructuring a subset of an interface's fields, so this is not an unused-variable situation and should not trigger any lint warning. Task 5 adds `allProfiles` to the destructure when it's needed; `currentUserId` is added in Task 4.

Manual check: `npm run dev`, log in as a `management` user, navigate to `/team-leaders` directly (no nav link yet — that's Task 6). Confirm one column renders per team, each showing its real leader (if any) and real member list, with correct names/departments. Confirm an `agent`/`admin` session redirects away from `/team-leaders` to `/dashboard` (the layout guard from Task 2 already enforces this). Report exact observations.

- [ ] **Step 5: Commit**

```bash
git add components/team-leaders/TeamLeadersBoard.tsx components/team-leaders/TeamColumn.tsx components/team-leaders/PersonCard.tsx
git commit -m "feat: add read-only Team Leaders Management board (no drag-and-drop yet)"
```

---

### Task 4: Drag-and-drop wiring + move/promote mutations

**Files:**
- Modify: `package.json` (add `@dnd-kit/core`, `@dnd-kit/utilities`)
- Modify: `components/team-leaders/PersonCard.tsx`
- Modify: `components/team-leaders/TeamColumn.tsx`
- Modify: `components/team-leaders/TeamLeadersBoard.tsx`

**Interfaces:**
- Consumes: `useDraggable`, `useDroppable`, `DndContext`, `DragEndEvent`, `PointerSensor`, `useSensor`, `useSensors` from `@dnd-kit/core`; `CSS` from `@dnd-kit/utilities`.
- Produces: working drag-and-drop. Dropping a card on a team's member zone moves them there; dropping on a team's leader zone assigns them as leader (auto-promoting to `admin` first if needed) and clears their previous leadership.

- [ ] **Step 1: Install the dependencies**

Run: `npm install @dnd-kit/core @dnd-kit/utilities`

- [ ] **Step 2: Make `PersonCard` draggable**

Replace the full contents of `components/team-leaders/PersonCard.tsx`:

```tsx
'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Pencil, UserX } from 'lucide-react'
import { Profile } from '@/types'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  person: PersonLite
  isLeader: boolean
  onEdit: (person: PersonLite) => void
  onDeactivate: (personId: string) => void
}

export default function PersonCard({ person, isLeader, onEdit, onDeactivate }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: person.id,
    data: { personId: person.id, role: person.role },
  })

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        isLeader
          ? 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20'
          : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900'
      } ${isDragging ? 'opacity-40' : ''} ${!person.is_active ? 'opacity-50' : ''}`}
    >
      <div {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{person.full_name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {person.department || person.role}
          {!person.is_active && ' · inactive'}
        </p>
      </div>
      <button type="button" onClick={() => onEdit(person)} className="p-1 text-gray-400 hover:text-blue-600 shrink-0">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={() => onDeactivate(person.id)} className="p-1 text-gray-400 hover:text-red-600 shrink-0">
        <UserX className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Make `TeamColumn`'s two zones droppable**

In `components/team-leaders/TeamColumn.tsx`, add the import `import { useDroppable } from '@dnd-kit/core'` alongside the existing imports, and replace the component body:

```tsx
export default function TeamColumn({ column, onEdit, onDeactivate, onAdd }: Props) {
  const { team, leader, members } = column
  const c = teamColorClasses[team.color]

  const leaderDroppable = useDroppable({ id: `leader:${team.id}` })
  const membersDroppable = useDroppable({ id: `members:${team.id}` })

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col w-72 shrink-0">
      <div className={`px-4 py-3 rounded-t-xl border-b ${c.border} ${c.lightBg}`}>
        <p className={`font-semibold text-sm ${c.text}`}>{team.name}</p>
      </div>

      <div className="p-3 space-y-2">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
          <Crown className="w-3 h-3" /> Leader
        </p>
        <div
          ref={leaderDroppable.setNodeRef}
          className={`min-h-[52px] rounded-lg border-2 border-dashed p-1 transition-colors ${
            leaderDroppable.isOver ? 'border-purple-400 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          {leader ? (
            <PersonCard person={leader} isLeader onEdit={onEdit} onDeactivate={onDeactivate} />
          ) : (
            <p className="text-xs text-gray-400 text-center py-3">Drop someone here to lead this team</p>
          )}
        </div>
      </div>

      <div className="px-3 pb-3 flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Members ({members.length})</p>
          <button type="button" onClick={() => onAdd(team.id)} className="text-gray-400 hover:text-blue-600">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div
          ref={membersDroppable.setNodeRef}
          className={`min-h-[80px] rounded-lg border-2 border-dashed p-1 space-y-1.5 transition-colors ${
            membersDroppable.isOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          {members.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No members</p>
          ) : (
            members.map(m => (
              <PersonCard key={m.id} person={m} isLeader={false} onEdit={onEdit} onDeactivate={onDeactivate} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
```

(Only the body changed — keep the file's existing imports/type declarations from Task 3, adding just the `useDroppable` import.)

- [ ] **Step 4: Wire `DndContext` and the mutations in `TeamLeadersBoard`**

Replace the full contents of `components/team-leaders/TeamLeadersBoard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { createClient } from '@/lib/supabase/client'
import { Team, TeamMember, TeamLeader, Profile, Role, TeamBoardColumn } from '@/types'
import TeamColumn from './TeamColumn'

type ProfileLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>
type TeamMemberRow = TeamMember & { profiles?: ProfileLite }
type TeamLeaderRow = TeamLeader & { profiles?: ProfileLite }

interface Props {
  teams: Team[]
  teamMembers: TeamMemberRow[]
  teamLeaders: TeamLeaderRow[]
  allProfiles: ProfileLite[]
  currentUserId: string
}

export default function TeamLeadersBoard({ teams, teamMembers, teamLeaders, currentUserId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const [error, setError] = useState('')

  const columns: TeamBoardColumn[] = teams.map(team => {
    const leaderRow = teamLeaders.find(tl => tl.team_id === team.id)
    const leader = leaderRow?.profiles ? { ...leaderRow.profiles, teamLeaderRowId: leaderRow.id } : null
    const members = teamMembers
      .filter(tm => tm.team_id === team.id && tm.profile_id !== leader?.id)
      .map(tm => tm.profiles)
      .filter((p): p is ProfileLite => p != null)
    return { team, leader, members }
  })

  async function moveToTeam(personId: string, newTeamId: string) {
    setError('')
    const { error: err } = await supabase.from('team_members')
      .upsert({ profile_id: personId, team_id: newTeamId, joined_at: new Date().toISOString() }, { onConflict: 'profile_id' })
    if (err) { setError('Could not move — please try again.'); return }
    router.refresh()
  }

  async function moveToLeaderSlot(personId: string, newTeamId: string, currentRole: Role) {
    setError('')

    if (currentRole !== 'admin') {
      const { error: promoteErr } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', personId)
      if (promoteErr) { setError('Could not promote to admin — please try again.'); return }
    }

    const oldLed = teamLeaders.find(tl => tl.profile_id === personId)
    if (oldLed && oldLed.team_id !== newTeamId) {
      await supabase.from('team_leaders').delete().eq('team_id', oldLed.team_id).eq('profile_id', personId)
    }

    const { error: leaderErr } = await supabase.from('team_leaders')
      .upsert({ team_id: newTeamId, profile_id: personId, assigned_by: currentUserId }, { onConflict: 'team_id' })
    if (leaderErr) { setError('Could not assign as leader — please try again.'); return }

    const { error: memberErr } = await supabase.from('team_members')
      .upsert({ profile_id: personId, team_id: newTeamId, joined_at: new Date().toISOString() }, { onConflict: 'profile_id' })
    if (memberErr) { setError('Assigned as leader, but could not update team membership — please refresh and check.') }

    router.refresh()
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const data = active.data.current as { personId: string; role: Role } | undefined
    if (!data) return

    const overId = String(over.id)
    if (overId.startsWith('leader:')) {
      void moveToLeaderSlot(data.personId, overId.slice('leader:'.length), data.role)
    } else if (overId.startsWith('members:')) {
      void moveToTeam(data.personId, overId.slice('members:'.length))
    }
  }

  async function handleDeactivate(personId: string) {
    if (!confirm('Deactivate this person? They will no longer be able to log in.')) return
    setError('')
    const { error: err } = await supabase.from('profiles').update({ is_active: false }).eq('id', personId)
    if (err) { setError('Could not deactivate — please try again.'); return }
    router.refresh()
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map(column => (
            <TeamColumn
              key={column.team.id}
              column={column}
              onEdit={() => {}}
              onDeactivate={handleDeactivate}
              onAdd={() => {}}
            />
          ))}
        </div>
      </div>
    </DndContext>
  )
}
```

(`onEdit`/`onAdd` remain no-ops — Task 5 wires the modals that back them.)

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors.

Manual check, logged in as `management` at `/team-leaders`:
1. Drag a regular agent card from one team's member list into a different team's member list. Confirm they disappear from the old team and appear in the new one after `router.refresh()`. Query `team_members` directly to confirm the row's `team_id` actually changed (same `id`, not a duplicate row).
2. Drag a team leader card into a different team's leader slot. Confirm they now show as that team's leader, no longer show as the old team's leader, and their `team_members` row also moved to the new team. Confirm the team they used to lead now shows "No leader assigned" (or whoever the drag displaced, if applicable).
3. Drag a plain `agent`-role card into any team's leader slot. Confirm: their role becomes `admin` (check `profiles.role` directly), they become that team's leader, and (if the target team already had a different leader) that previous leader is no longer marked as leading it.
4. Attempt to drag a card and drop it outside any droppable zone (e.g., onto empty page background) — confirm nothing changes (no error, no accidental mutation).

Report exact before/after DB values for each check, not just UI appearance.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json components/team-leaders/PersonCard.tsx components/team-leaders/TeamColumn.tsx components/team-leaders/TeamLeadersBoard.tsx
git commit -m "feat: add drag-and-drop team/leader reassignment to Team Leaders Management board"
```

---

### Task 5: Edit and Add modals

**Files:**
- Create: `components/team-leaders/EditPersonModal.tsx`
- Create: `components/team-leaders/AddToTeamModal.tsx`
- Modify: `components/team-leaders/TeamLeadersBoard.tsx`

**Interfaces:**
- Consumes: `Modal` from `@/components/ui/Modal` (already used identically by `CustomerManager`, `AssignTeamLeaderModal`, etc.); `Role` from `@/types`; `createClient` from `@/lib/supabase/client`.
- Produces: working Edit and Add-to-team flows, wired into the board's `onEdit`/`onAdd` handlers.

- [ ] **Step 1: Add `EditPersonModal`**

Create `components/team-leaders/EditPersonModal.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Role, Profile } from '@/types'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  person: PersonLite | null
  isCurrentlyLeading: boolean
  onClose: () => void
  onSuccess: () => void
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function EditPersonModal({ person, isCurrentlyLeading, onClose, onSuccess }: Props) {
  const [form, setForm] = useState({ full_name: '', department: '', role: 'agent' as Role })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (person) {
      setForm({ full_name: person.full_name, department: person.department || '', role: person.role })
      setError('')
    }
  }, [person])

  if (!person) return null

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (isCurrentlyLeading && form.role !== 'admin') {
      setError('This person currently leads a team — remove them as team leader (drag them out of the leader slot) before changing their role away from admin.')
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: form.full_name, department: form.department || null, role: form.role })
      .eq('id', person.id)

    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
  }

  return (
    <Modal open={!!person} onClose={onClose} title="Edit Person">
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className={labelCls}>Full Name</label>
          <input required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Department</label>
          <input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Role</label>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))} className={inputCls}>
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
            <option value="management">Management</option>
          </select>
          {isCurrentlyLeading && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Currently leads a team — must stay Admin, or be removed as leader first.</p>
          )}
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors font-medium">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 2: Add `AddToTeamModal`**

Create `components/team-leaders/AddToTeamModal.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Profile } from '@/types'

type UnassignedPerson = Pick<Profile, 'id' | 'full_name' | 'email'>

interface Props {
  teamId: string | null
  unassigned: UnassignedPerson[]
  onClose: () => void
  onSuccess: () => void
}

export default function AddToTeamModal({ teamId, unassigned, onClose, onSuccess }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!teamId) return null

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId) return
    setSaving(true)
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('team_members')
      .upsert({ profile_id: selectedId, team_id: teamId, joined_at: new Date().toISOString() }, { onConflict: 'profile_id' })

    setSaving(false)
    if (err) { setError(err.message); return }
    setSelectedId('')
    onSuccess()
  }

  return (
    <Modal open={!!teamId} onClose={onClose} title="Add to Team">
      <form onSubmit={handleAdd} className="space-y-4">
        {unassigned.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No unassigned people available.</p>
        ) : (
          <select
            required
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">Select a person…</option>
            {unassigned.map(p => (
              <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>
            ))}
          </select>
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Cancel</button>
          <button type="submit" disabled={saving || !selectedId} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors font-medium">
            {saving ? 'Adding...' : 'Add to Team'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 3: Wire both modals into `TeamLeadersBoard`**

In `components/team-leaders/TeamLeadersBoard.tsx`:

Add imports:
```ts
import EditPersonModal from './EditPersonModal'
import AddToTeamModal from './AddToTeamModal'
```

Add state (alongside the existing `error` state):
```ts
const [editingPerson, setEditingPerson] = useState<ProfileLite | null>(null)
const [addingToTeamId, setAddingToTeamId] = useState<string | null>(null)
```

Add, after the `columns` derivation:
```ts
const unassigned = allProfiles.filter(p => !teamMembers.some(tm => tm.profile_id === p.id))
```

Change the component signature to destructure `allProfiles` too (it was dropped in Task 4's version):
```ts
export default function TeamLeadersBoard({ teams, teamMembers, teamLeaders, allProfiles, currentUserId }: Props) {
```

Replace the `onEdit`/`onAdd` no-ops on `<TeamColumn>` with real handlers:
```tsx
<TeamColumn
  key={column.team.id}
  column={column}
  onEdit={setEditingPerson}
  onDeactivate={handleDeactivate}
  onAdd={setAddingToTeamId}
/>
```

Add the two modals just before the closing `</DndContext>`:
```tsx
      <EditPersonModal
        person={editingPerson}
        isCurrentlyLeading={editingPerson ? teamLeaders.some(tl => tl.profile_id === editingPerson.id) : false}
        onClose={() => setEditingPerson(null)}
        onSuccess={() => { setEditingPerson(null); router.refresh() }}
      />
      <AddToTeamModal
        teamId={addingToTeamId}
        unassigned={unassigned}
        onClose={() => setAddingToTeamId(null)}
        onSuccess={() => { setAddingToTeamId(null); router.refresh() }}
      />
    </DndContext>
```

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors.

Manual check, logged in as `management`:
1. Click Edit on a regular agent card, change their department, save. Confirm it persists after refresh.
2. Click Edit on a current team leader, try changing their role to `agent`, confirm the inline error blocks it and nothing is saved. Then try changing an unrelated field (department) — confirm that still saves fine while role stays `admin`.
3. Click "+" on a team with at least one unassigned person available; confirm the dropdown lists only people not currently on any team; add one; confirm they now appear in that team's member list and disappear from the unassigned pool (re-open the Add modal on another team to confirm they're no longer offered).
4. Click the deactivate icon on a card; confirm the browser confirmation prompt appears, and confirming it sets `is_active = false` (card should now render with reduced opacity and an "inactive" label per Task 3's styling).

- [ ] **Step 5: Commit**

```bash
git add components/team-leaders/EditPersonModal.tsx components/team-leaders/AddToTeamModal.tsx components/team-leaders/TeamLeadersBoard.tsx
git commit -m "feat: add Edit and Add-to-team modals to Team Leaders Management board"
```

---

### Task 6: Navigation + routing

**Files:**
- Modify: `components/layout/Sidebar.tsx`
- Modify: `proxy.ts`

**Interfaces:**
- Consumes: `getPrimaryLinks(role)` (already exists, added for the Coaching page).
- Produces: `management` users see "Team Leaders Management" instead of "Callbacks" in the sidebar; `/team-leaders` redirects non-`management` roles to `/dashboard` at the proxy layer too (defense in depth alongside Task 2's layout guard).

- [ ] **Step 1: Update `Sidebar.tsx`**

In `components/layout/Sidebar.tsx`, add `Users2` to the existing `lucide-react` import list, and change `getPrimaryLinks`:

```ts
function getPrimaryLinks(role: Role) {
  return [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    role === 'management'
      ? { href: '/coaching', label: 'Coaching', icon: Handshake }
      : { href: '/customers', label: 'Customers', icon: Users },
    role === 'management'
      ? { href: '/team-leaders', label: 'Team Leaders Management', icon: Users2 }
      : { href: '/callbacks', label: 'Callbacks', icon: Phone },
    { href: '/followups', label: 'Follow-ups', icon: FileText },
    { href: '/roster', label: 'Team Roster', icon: CalendarDays },
  ]
}
```

- [ ] **Step 2: Add the `proxy.ts` gate**

In `proxy.ts`, add alongside the existing `/coaching` block:

```ts
if (pathname.startsWith('/team-leaders') && profile?.role !== 'management') {
  return NextResponse.redirect(new URL('/dashboard', request.url))
}
```

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors.

Manual check:
1. Log in as `management`: confirm the sidebar shows "Coaching" and "Team Leaders Management," with no "Customers" or "Callbacks" entries.
2. Log in as `agent`: confirm the sidebar shows "Customers" and "Callbacks" exactly as before, unaffected. Confirm `/callbacks` still loads and works normally.
3. Log in as `admin`: same check as agent — sidebar and `/callbacks` unaffected.
4. As `agent` or `admin`, type `/team-leaders` directly in the URL bar: confirm redirect to `/dashboard`.

- [ ] **Step 4: Commit**

```bash
git add components/layout/Sidebar.tsx proxy.ts
git commit -m "feat: wire Team Leaders Management into navigation and routing for management role"
```

---

### Task 7: Full manual QA pass

**Files:** none (verification only — if QA finds a bug, fix it in the relevant file and commit that fix separately with a clear message).

**Interfaces:** N/A.

- [ ] **Step 1: Confirm agent/admin are completely unaffected**

Log in as each of `agent` and `admin`. Confirm: sidebar identical to before this feature; `/customers` and `/callbacks` both load and function normally; `/coaching` and `/team-leaders` both redirect to `/dashboard`.

- [ ] **Step 2: Full management journey, one team leader end to end**

Log in as `management`. On `/team-leaders`:
1. Drag an existing agent into a different team.
2. Drag that same agent into a team's leader slot (promoting them).
3. Edit their department.
4. Add a previously-unassigned person to a team.
5. Deactivate someone, then reactivate them via Edit (or confirm there's a way to — if not, note this as a gap: is there any way to reactivate someone from this page? If not, flag it, but do not block on it since re-activation wasn't part of the original requirement).

Report each step's exact observation and the underlying DB state (not just what the UI shows).

- [ ] **Step 3: Edge cases**

- Attempt to demote a current team leader's role via Edit — confirm blocked.
- Drag a team leader into a *different* team's leader slot when that target team already has a leader — confirm the previous leader is displaced (no longer marked as leading that team) and the dragged person takes over.
- Confirm dragging a card and dropping it in the exact same slot it came from doesn't cause any visible error or duplicate row.

- [ ] **Step 4: Final commit (only if QA fixes were made)**

If Steps 1-3 required any code fixes, commit each individually with a message describing the specific bug fixed. If everything passed with no fixes needed, say so clearly.

---

## Plan Self-Review

**Spec coverage:** RLS widening (Task 1), types + fetch layer (Task 2), read-only board (Task 3), drag-and-drop + move/promote mutations (Task 4), Edit/Add modals including the role-demotion guard (Task 5), nav/routing (Task 6), full QA (Task 7) — every item from the approved design doc (`docs/superpowers/specs/2026-08-08-team-leaders-management-design.md`) is covered, including the two edge cases surfaced during design (leader's `team_members` row kept in sync; role-demotion-while-leading guard).

**Placeholder scan:** No TBD/TODO markers. Task 3's no-op `onEdit`/`onAdd={() => {}}` and Task 4's still-unused `allProfiles` prop are disclosed mid-plan intermediate states with an explicit note explaining why, not silent placeholders — they're wired up in Tasks 4 and 5 respectively.

**Type consistency:** `TeamBoardColumn` (Task 2) is produced and consumed identically in Task 3's `TeamLeadersBoard`. `PersonLite`/`ProfileLite`/`TeamMemberRow`/`TeamLeaderRow` local type aliases are spelled identically across `PersonCard.tsx`, `TeamColumn.tsx`, `TeamLeadersBoard.tsx`, `EditPersonModal.tsx`, and `AddToTeamModal.tsx` in every task that touches them. The `onEdit`/`onDeactivate`/`onAdd` callback signatures declared in Task 3's `TeamColumn` props are used with matching signatures when wired to real handlers in Tasks 4-5.
