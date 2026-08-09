# Admin Agents Board Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin-only "Manage Agents" page render the exact same kanban board component the `management`-role "Team Management" page already uses, with two admin-only actions (Assign Shift, Deactivate/Activate) layered on top.

**Architecture:** `TeamLeadersBoard.tsx` gains two new optional props (`isAdminView`, `shiftTemplates`) and two new optional per-person callbacks threaded through `PersonCard`/`TeamColumn`/`UnassignedPanel` (`onAssignShift`, `onToggleActive`), following the exact same "optional prop → conditionally rendered button" pattern `onRemove` already uses. `app/(app)/admin/agents/page.tsx` is rewritten to fetch the board's data shape (plus shift templates and inactive profiles) and render `TeamLeadersBoard` directly — no manager-component wrapper, matching how `app/(app)/team-leaders/page.tsx` already calls the board. `AgentManager.tsx` and `ManageTeamsModal.tsx` are deleted once nothing references them.

**Tech Stack:** Next.js 16 App Router, React, `@dnd-kit/core`, Tailwind, `lucide-react`. No new dependencies.

## Global Constraints

- No automated test suite exists in this project (confirmed in `CLAUDE.md`) — every task's "verify" step is a manual/live check.
- Every new prop added to `PersonCard`, `TeamColumn`, `UnassignedPanel`, and `EditPersonModal` must be **optional** with a safe default (`undefined`/`false`), so `app/(app)/team-leaders/page.tsx`'s existing call site to `TeamLeadersBoard` needs ZERO changes and `management`-role behavior is byte-for-byte unchanged. Every task in this plan must leave `npx tsc --noEmit` fully clean — no task in this plan is allowed to leave an "expected" compile error for a later task to fix, unlike some earlier plans in this codebase; the optional-prop design makes that unnecessary here.
- The self-card safety guard: on the card whose `person.id === currentUserId`, `onAssignShift`/`onToggleActive` must never be passed (not just hidden by CSS) — comparisons happen once, at the point each `<PersonCard>` is rendered inside `TeamColumn`/`UnassignedPanel`, using a `currentUserId` prop threaded down to those two components.
- `EditPersonModal`'s Role `<select>` must be `disabled` when editing your own profile (`person.id === currentUserId`), AND `handleSave` must ignore any role value in local state when saving your own profile (defense in depth against a disabled-but-tampered form field) — silently keep the existing role rather than erroring.
- `ManageTeamsModal.tsx` has exactly one caller in the whole repo (`AgentManager.tsx`, confirmed via repo-wide search) — safe to delete once `AgentManager.tsx` is deleted. `AssignTeamModal`/`AssignTeamLeaderModal` (in `components/roster/admin/`) are NOT deleted — `components/roster/RosterManager.tsx` uses both independently and is untouched by this plan.
- The admin page's `profiles` fetch must include **inactive** profiles (no `.eq('is_active', true)` filter) — admin needs to find and reactivate deactivated accounts. The management page's fetch is unchanged (still no such filter either, since the *board's own* `unassigned` computation is what currently does the active-only filtering — this plan changes that computation to be conditional on `isAdminView`, not the page-level fetch).

---

### Task 1: Add optional admin-action props to `PersonCard`, `TeamColumn`, `UnassignedPanel`

**Files:**
- Modify: `components/team-leaders/PersonCard.tsx`
- Modify: `components/team-leaders/TeamColumn.tsx`
- Modify: `components/team-leaders/UnassignedPanel.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PersonCard` accepts two new optional props, `onAssignShift?: (personId: string, fullName: string) => void` and `onToggleActive?: (personId: string, isActive: boolean) => void`, each rendered as an additional icon button only when provided. `TeamColumn` and `UnassignedPanel` each gain a new required `currentUserId: string` prop plus the same two optional callback props, forwarded to their `<PersonCard>` calls with the self-card guard (`person.id === currentUserId ? undefined : <callback>`). No task in this repo yet passes these new props — that's expected and resolved in Task 3.

- [ ] **Step 1: Add the two new buttons to `PersonCard`**

Replace the full contents of `components/team-leaders/PersonCard.tsx`:

```tsx
'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Pencil, UserMinus, Clock, CheckCircle, XCircle } from 'lucide-react'
import { Profile } from '@/types'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  person: PersonLite
  isLeader: boolean
  onEdit: (person: PersonLite) => void
  onRemove?: (personId: string) => void
  onAssignShift?: (personId: string, fullName: string) => void
  onToggleActive?: (personId: string, isActive: boolean) => void
}

export default function PersonCard({ person, isLeader, onEdit, onRemove, onAssignShift, onToggleActive }: Props) {
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
      {onAssignShift && (
        <button type="button" onClick={() => onAssignShift(person.id, person.full_name)} className="p-1 text-gray-400 hover:text-blue-600 shrink-0" title="Assign shift">
          <Clock className="w-3.5 h-3.5" />
        </button>
      )}
      {onToggleActive && (
        <button type="button" onClick={() => onToggleActive(person.id, person.is_active)} className="p-1 text-gray-400 hover:text-red-600 shrink-0" title={person.is_active ? 'Deactivate' : 'Activate'}>
          {person.is_active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
        </button>
      )}
      {onRemove && (
        <button type="button" onClick={() => onRemove(person.id)} className="p-1 text-gray-400 hover:text-red-600 shrink-0" title="Remove from team">
          <UserMinus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Thread the new props through `TeamColumn` with the self-card guard**

Replace the full contents of `components/team-leaders/TeamColumn.tsx`:

```tsx
'use client'

import { useDroppable } from '@dnd-kit/core'
import { Plus, Crown, UserPlus, Pencil, Trash2 } from 'lucide-react'
import { TeamBoardColumn, Profile, Team } from '@/types'
import PersonCard from './PersonCard'
import { teamColorClasses } from '@/lib/roster/teamColors'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  column: TeamBoardColumn
  currentUserId: string
  onEdit: (person: PersonLite) => void
  onRemove: (personId: string, teamId: string, isLeader: boolean) => void
  onAdd: (teamId: string) => void
  onAddLeader: (teamId: string) => void
  onRenameTeam: (team: Team) => void
  onDeleteTeam: (team: Team) => void
  onAssignShift?: (personId: string, fullName: string) => void
  onToggleActive?: (personId: string, isActive: boolean) => void
}

export default function TeamColumn({ column, currentUserId, onEdit, onRemove, onAdd, onAddLeader, onRenameTeam, onDeleteTeam, onAssignShift, onToggleActive }: Props) {
  const { team, leader, members } = column
  const c = teamColorClasses[team.color]

  const { setNodeRef: setLeaderRef, isOver: isLeaderOver } = useDroppable({ id: `leader:${team.id}` })
  const { setNodeRef: setMembersRef, isOver: isMembersOver } = useDroppable({ id: `members:${team.id}` })

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col">
      <div className={`px-4 py-3 rounded-t-xl border-b flex items-center justify-between gap-2 ${c.border} ${c.lightBg}`}>
        <p className={`font-semibold text-sm truncate ${c.text}`}>{team.name}</p>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => onRenameTeam(team)} className={`opacity-60 hover:opacity-100 ${c.text}`} title="Rename team">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => onDeleteTeam(team)} className="opacity-60 hover:opacity-100 hover:text-red-600" title="Delete team">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
            <Crown className="w-3 h-3" /> Leader
          </p>
          <button type="button" onClick={() => onAddLeader(team.id)} className="text-gray-400 hover:text-purple-600" title="Assign team leader">
            <UserPlus className="w-4 h-4" />
          </button>
        </div>
        <div
          ref={setLeaderRef}
          className={`min-h-13 rounded-lg border-2 border-dashed p-1 transition-colors ${
            isLeaderOver ? 'border-purple-400 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          {leader ? (
            <PersonCard
              person={leader}
              isLeader
              onEdit={onEdit}
              onRemove={id => onRemove(id, team.id, true)}
              onAssignShift={leader.id === currentUserId ? undefined : onAssignShift}
              onToggleActive={leader.id === currentUserId ? undefined : onToggleActive}
            />
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
          ref={setMembersRef}
          className={`min-h-20 rounded-lg border-2 border-dashed p-1 space-y-1.5 transition-colors ${
            isMembersOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          {members.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No members</p>
          ) : (
            members.map(m => (
              <PersonCard
                key={m.id}
                person={m}
                isLeader={false}
                onEdit={onEdit}
                onRemove={id => onRemove(id, team.id, false)}
                onAssignShift={m.id === currentUserId ? undefined : onAssignShift}
                onToggleActive={m.id === currentUserId ? undefined : onToggleActive}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Thread the new props through `UnassignedPanel`**

Replace the full contents of `components/team-leaders/UnassignedPanel.tsx`:

```tsx
'use client'

import { Profile } from '@/types'
import PersonCard from './PersonCard'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  people: PersonLite[]
  currentUserId: string
  onEdit: (person: PersonLite) => void
  onAssignShift?: (personId: string, fullName: string) => void
  onToggleActive?: (personId: string, isActive: boolean) => void
}

export default function UnassignedPanel({ people, currentUserId, onEdit, onAssignShift, onToggleActive }: Props) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 space-y-2">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Unassigned ({people.length})</p>
      <div className="flex flex-wrap gap-2">
        {people.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3 w-full">No unassigned people</p>
        ) : (
          people.map(p => (
            <div key={p.id} className="w-64">
              <PersonCard
                person={p}
                isLeader={false}
                onEdit={onEdit}
                onAssignShift={p.id === currentUserId ? undefined : onAssignShift}
                onToggleActive={p.id === currentUserId ? undefined : onToggleActive}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit`. This is EXPECTED to fail right now with exactly two errors, both in `components/team-leaders/TeamLeadersBoard.tsx` — its existing `<TeamColumn ... />` and `<UnassignedPanel ... />` calls are missing the new required `currentUserId` prop these two components now declare. This is expected and resolved by Task 3, which is the task that updates `TeamLeadersBoard.tsx` itself. No other errors should appear. Run `npm run lint` — expect no errors on the three files this task touched (pre-existing errors elsewhere are out of scope).

- [ ] **Step 5: Commit**

```bash
git add components/team-leaders/PersonCard.tsx components/team-leaders/TeamColumn.tsx components/team-leaders/UnassignedPanel.tsx
git commit -m "feat: add optional Assign Shift / Deactivate actions to PersonCard"
```

---

### Task 2: Add the self-edit role guard to `EditPersonModal`

**Files:**
- Modify: `components/team-leaders/EditPersonModal.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `EditPersonModal` accepts a new optional prop `currentUserId?: string`. When `person.id === currentUserId`, the Role `<select>` is disabled, an explanatory note is shown, and `handleSave` ignores any role value in local state (always saves the person's original `role`) regardless of what the (disabled, but defensively re-checked) select's value might be.

- [ ] **Step 1: Add the guard**

Replace the full contents of `components/team-leaders/EditPersonModal.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Role, Profile } from '@/types'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  person: PersonLite | null
  isCurrentlyLeading: boolean
  currentUserId?: string
  onClose: () => void
  onSuccess: () => void
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function EditPersonModal({ person, isCurrentlyLeading, currentUserId, onClose, onSuccess }: Props) {
  // Rendered with a key={person.id} by the caller, so a fresh instance (and
  // fresh initial state below) mounts whenever a different person is edited
  // — no effect needed to "reset" the form on prop change.
  const [form, setForm] = useState(() => ({
    full_name: person?.full_name ?? '',
    department: person?.department ?? '',
    role: (person?.role ?? 'agent') as Role,
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!person) return null
  const currentPerson = person
  const isSelf = currentUserId === currentPerson.id

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
      .update({ full_name: form.full_name, department: form.department || null, role: isSelf ? currentPerson.role : form.role })
      .eq('id', currentPerson.id)

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
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))} disabled={isSelf} className={inputCls}>
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
            <option value="management">Management</option>
          </select>
          {isSelf && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">You can&apos;t change your own role here.</p>
          )}
          {!isSelf && isCurrentlyLeading && (
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

(Note the `isCurrentlyLeading` note is now guarded with `!isSelf &&` so the two notes never show at once — `isSelf` already fully explains why the select is disabled, and showing both would be confusing/contradictory since the leading-related note talks about a role value the user can't even change right now.)

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit` — expect the SAME two pre-existing expected errors from Task 1 (in `TeamLeadersBoard.tsx`, unrelated to this file), and no new errors. Run `npm run lint` — expect no errors on this file.

- [ ] **Step 3: Commit**

```bash
git add components/team-leaders/EditPersonModal.tsx
git commit -m "feat: disable self-role-editing in EditPersonModal"
```

---

### Task 3: Wire `isAdminView` into `TeamLeadersBoard`

**Files:**
- Modify: `components/team-leaders/TeamLeadersBoard.tsx`

**Interfaces:**
- Consumes: `AssignShiftModal` from `@/components/roster/admin/AssignShiftModal` (existing component, props `{ open, onClose, onSuccess, profileId, profileName, shiftTemplates, currentUserId }`); `ShiftTemplate` from `@/types`; Task 1's new `currentUserId`/`onAssignShift`/`onToggleActive` props on `TeamColumn`/`UnassignedPanel`; Task 2's new `currentUserId` prop on `EditPersonModal`.
- Produces: `TeamLeadersBoard` accepts two new optional props, `isAdminView?: boolean` (default `false`) and `shiftTemplates?: ShiftTemplate[]` (default `[]`). This resolves the two expected compile errors from Tasks 1-2.

- [ ] **Step 1: Replace the full file**

Replace the full contents of `components/team-leaders/TeamLeadersBoard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Team, TeamMember, TeamLeader, Profile, Role, TeamBoardColumn, ShiftTemplate } from '@/types'
import TeamColumn from './TeamColumn'
import EditPersonModal from './EditPersonModal'
import AddToTeamModal from './AddToTeamModal'
import AddTeamLeaderModal from './AddTeamLeaderModal'
import AddTeamModal from './AddTeamModal'
import EditTeamNameModal from './EditTeamNameModal'
import AddTeamMemberModal from './AddTeamMemberModal'
import UnassignedPanel from './UnassignedPanel'
import AssignShiftModal from '@/components/roster/admin/AssignShiftModal'

type ProfileLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  teams: Team[]
  teamMembers: TeamMember[]
  teamLeaders: TeamLeader[]
  allProfiles: ProfileLite[]
  currentUserId: string
  isAdminView?: boolean
  shiftTemplates?: ShiftTemplate[]
}

export default function TeamLeadersBoard({ teams, teamMembers, teamLeaders, allProfiles, currentUserId, isAdminView = false, shiftTemplates = [] }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const [error, setError] = useState('')
  const [editingPerson, setEditingPerson] = useState<ProfileLite | null>(null)
  const [addingToTeamId, setAddingToTeamId] = useState<string | null>(null)
  const [addingLeaderToTeamId, setAddingLeaderToTeamId] = useState<string | null>(null)
  const [addingTeam, setAddingTeam] = useState(false)
  const [addingTeamMember, setAddingTeamMember] = useState(false)
  const [renamingTeam, setRenamingTeam] = useState<Team | null>(null)
  const [assignShiftPerson, setAssignShiftPerson] = useState<{ id: string; full_name: string } | null>(null)

  function findProfile(id: string) {
    return allProfiles.find(p => p.id === id)
  }

  const columns: TeamBoardColumn[] = teams.map(team => {
    const leaderRow = teamLeaders.find(tl => tl.team_id === team.id)
    const leaderProfile = leaderRow ? findProfile(leaderRow.profile_id) : undefined
    const leader = leaderProfile ? { ...leaderProfile, teamLeaderRowId: leaderRow!.id } : null

    const members = teamMembers
      .filter(tm => tm.team_id === team.id && tm.profile_id !== leader?.id)
      .map(tm => findProfile(tm.profile_id))
      .filter((p): p is ProfileLite => p != null)

    return { team, leader, members }
  })

  const unassigned = allProfiles.filter(p => (isAdminView || p.is_active) && !teamMembers.some(tm => tm.profile_id === p.id))

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

  async function handleRemoveFromTeam(personId: string, teamId: string, isLeader: boolean) {
    if (!confirm('Remove this person from this team?')) return
    setError('')

    if (isLeader) {
      const { error: leaderErr } = await supabase.from('team_leaders').delete().eq('profile_id', personId).eq('team_id', teamId)
      if (leaderErr) { setError('Could not remove as leader — please try again.'); return }
    }

    // Only clear their team_members row if it currently points at this same
    // team — a person leading multiple teams could have their one
    // membership row pointing at a different team than the one being
    // removed here, and removing leadership of team A shouldn't unassign
    // them from team B.
    const membership = teamMembers.find(tm => tm.profile_id === personId)
    if (membership && membership.team_id === teamId) {
      const { error: memberErr } = await supabase.from('team_members').delete().eq('profile_id', personId)
      if (memberErr) { setError('Could not remove from team — please try again.'); return }
    }

    router.refresh()
  }

  async function handleDeleteTeam(team: Team) {
    if (!confirm(`Delete the "${team.name}" team? This also removes its leader and member assignments. This cannot be undone.`)) return
    setError('')
    const { error: err } = await supabase.from('teams').delete().eq('id', team.id)
    if (err) { setError('Could not delete team — please try again.'); return }
    router.refresh()
  }

  async function handleToggleActive(personId: string, isActive: boolean) {
    setError('')
    const { error: err } = await supabase.from('profiles').update({ is_active: !isActive }).eq('id', personId)
    if (err) { setError('Could not update status — please try again.'); return }
    router.refresh()
  }

  const onAssignShift = isAdminView ? (id: string, fullName: string) => setAssignShiftPerson({ id, full_name: fullName }) : undefined
  const onToggleActive = isAdminView ? handleToggleActive : undefined

  return (
    <DndContext id="team-leaders-board" sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setAddingTeamMember(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Team Member
          </button>
          <button
            type="button"
            onClick={() => setAddingTeam(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Team
          </button>
        </div>
        <UnassignedPanel
          people={unassigned}
          currentUserId={currentUserId}
          onEdit={setEditingPerson}
          onAssignShift={onAssignShift}
          onToggleActive={onToggleActive}
        />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {columns.map(column => (
            <TeamColumn
              key={column.team.id}
              column={column}
              currentUserId={currentUserId}
              onEdit={setEditingPerson}
              onRemove={handleRemoveFromTeam}
              onAdd={setAddingToTeamId}
              onAddLeader={setAddingLeaderToTeamId}
              onRenameTeam={setRenamingTeam}
              onDeleteTeam={handleDeleteTeam}
              onAssignShift={onAssignShift}
              onToggleActive={onToggleActive}
            />
          ))}
        </div>
      </div>

      <EditPersonModal
        key={editingPerson?.id ?? 'edit-modal-closed'}
        person={editingPerson}
        isCurrentlyLeading={editingPerson ? teamLeaders.some(tl => tl.profile_id === editingPerson.id) : false}
        currentUserId={currentUserId}
        onClose={() => setEditingPerson(null)}
        onSuccess={() => { setEditingPerson(null); router.refresh() }}
      />
      <AddToTeamModal
        teamId={addingToTeamId}
        unassigned={unassigned}
        onClose={() => setAddingToTeamId(null)}
        onSuccess={() => { setAddingToTeamId(null); router.refresh() }}
      />
      <AddTeamLeaderModal
        teamId={addingLeaderToTeamId}
        candidates={allProfiles.filter(p => p.is_active)}
        onClose={() => setAddingLeaderToTeamId(null)}
        onAssign={async personId => {
          const person = findProfile(personId)
          await moveToLeaderSlot(personId, addingLeaderToTeamId!, person?.role ?? 'agent')
          setAddingLeaderToTeamId(null)
        }}
      />
      <AddTeamModal
        open={addingTeam}
        onClose={() => setAddingTeam(false)}
        onSuccess={() => { setAddingTeam(false); router.refresh() }}
      />
      <AddTeamMemberModal
        open={addingTeamMember}
        onClose={() => setAddingTeamMember(false)}
        onSuccess={() => router.refresh()}
      />
      <EditTeamNameModal
        key={renamingTeam?.id ?? 'rename-team-modal-closed'}
        team={renamingTeam}
        onClose={() => setRenamingTeam(null)}
        onSuccess={() => { setRenamingTeam(null); router.refresh() }}
      />
      {isAdminView && (
        <AssignShiftModal
          open={!!assignShiftPerson}
          onClose={() => setAssignShiftPerson(null)}
          onSuccess={() => { setAssignShiftPerson(null); router.refresh() }}
          profileId={assignShiftPerson?.id ?? ''}
          profileName={assignShiftPerson?.full_name ?? ''}
          shiftTemplates={shiftTemplates}
          currentUserId={currentUserId}
        />
      )}
    </DndContext>
  )
}
```

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect ZERO errors now (Tasks 1-2's two expected errors are resolved).

Manual check, `npm run dev`, logged in as `management`, on `/team-leaders`: confirm the page renders and behaves EXACTLY as before this task — no Assign Shift or Deactivate buttons anywhere, Unassigned panel still active-people-only, everything else (drag-and-drop, Add Team, Add Team Member, Edit, Remove, rename/delete team) working identically to before. This is the critical regression check for this task, since `isAdminView` defaults to `false` and nothing has wired it to `true` yet (that's Task 4).

- [ ] **Step 3: Commit**

```bash
git add components/team-leaders/TeamLeadersBoard.tsx
git commit -m "feat: wire isAdminView and shiftTemplates into TeamLeadersBoard"
```

---

### Task 4: Rewrite the admin agents page, delete superseded files

**Files:**
- Modify: `app/(app)/admin/agents/page.tsx`
- Delete: `components/admin/AgentManager.tsx`
- Delete: `components/admin/ManageTeamsModal.tsx`

**Interfaces:**
- Consumes: `TeamLeadersBoard` from `@/components/team-leaders/TeamLeadersBoard` with its new `isAdminView`/`shiftTemplates` props (Task 3).
- Produces: `/admin/agents` renders the board with `isAdminView` set.

- [ ] **Step 1: Replace the page**

Replace the full contents of `app/(app)/admin/agents/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import TeamLeadersBoard from '@/components/team-leaders/TeamLeadersBoard'

export default async function AdminAgentsPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  const [
    { data: teams },
    { data: teamMembers },
    { data: teamLeaders },
    { data: allProfiles },
    { data: shiftTemplates },
  ] = await Promise.all([
    supabase.from('teams').select('*').order('name'),
    supabase.from('team_members').select('*'),
    supabase.from('team_leaders').select('*'),
    supabase.from('profiles').select('id, full_name, email, role, department, is_active'),
    supabase.from('shift_templates').select('*').order('name'),
  ])

  return (
    <div>
      <Header title="Manage Agents" userId={userId!} userRole="admin" />
      <div className="p-6">
        <TeamLeadersBoard
          isAdminView
          shiftTemplates={shiftTemplates || []}
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

Note this fetches ALL profiles with no `.eq('is_active', true)` filter — matching `app/(app)/team-leaders/page.tsx`'s own fetch exactly. The difference in whether inactive people are visible comes entirely from `isAdminView` gating the `unassigned` computation inside `TeamLeadersBoard` (Task 3), not from anything in this fetch.

- [ ] **Step 2: Delete the superseded files**

```bash
git rm components/admin/AgentManager.tsx components/admin/ManageTeamsModal.tsx
```

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors (confirms nothing else in the repo still imports either deleted file).

Manual check, logged in as `admin`, on `/admin/agents`:
1. Confirm the page now renders the same board layout as `/team-leaders` — team columns, Unassigned panel, drag-and-drop.
2. Confirm the Unassigned panel includes deactivated people too (greyed out).
3. Confirm every card except your own shows Assign Shift and Deactivate/Activate buttons alongside Edit and (if on a team) Remove.
4. Confirm your own card has NO Assign Shift or Deactivate button, but Edit still opens and works for name/department; the Role field is disabled with the "You can't change your own role here" note.
5. Confirm dragging your own card to a different team/leader slot still works.
6. Confirm "Manage Teams" is gone; creating a team via "Add Team" and renaming/deleting a team via each column's icons still work.
7. Confirm clicking Assign Shift on someone else opens the existing shift-assignment flow and it still works end to end.
8. Confirm clicking Deactivate on someone else works, they show greyed out in Unassigned (or their team, if still on one), and clicking Activate on them reverses it.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/admin/agents/page.tsx"
git commit -m "feat: render the shared team board on the admin agents page"
```

---

### Task 5: Full manual QA pass

**Files:** none (verification only — if QA finds a bug, fix it in the relevant file and commit that fix separately with a clear message).

**Interfaces:** N/A.

- [ ] **Step 1: Management regression check**

Log in as `management`, on `/team-leaders`: confirm everything still looks and behaves exactly as it did before this whole plan — no Assign Shift/Deactivate anywhere, Unassigned panel still active-only. This is the single most important regression check in this plan, since one shared component now serves two very different-privilege audiences.

- [ ] **Step 2: `RosterManager` regression check**

Log in as `admin`, go to the Roster page (`/roster`): confirm "Assign Team" and "Assign Shift" actions there (via `RosterManager`'s own use of `AssignTeamModal`/`AssignShiftModal`) still work — these components were not modified by this plan, but confirm nothing else broke their usage.

- [ ] **Step 3: Full admin journey**

Log in as `admin`, on `/admin/agents`:
1. Create a new team member via "Add Team Member," confirm they land in Unassigned.
2. Assign them a shift.
3. Drag them onto a team.
4. Deactivate a different, unrelated person; confirm they still show (greyed out) wherever they were (team or Unassigned).
5. Reactivate them.
6. Edit your own profile's name; confirm it saves and the Role field was disabled throughout.

Report each step's exact observation, not just "it worked."

- [ ] **Step 4: Final commit (only if QA fixes were made)**

If Steps 1-3 required any code fixes, commit each individually with a message describing the specific bug fixed. If everything passed with no fixes needed, say so clearly.

---

## Plan Self-Review

**Spec coverage:** Shared board reuse via `isAdminView`/`shiftTemplates` props (Tasks 3-4), Assign Shift + Deactivate/Activate as optional per-card actions (Task 1), inactive people visible in Unassigned for admin only (Task 3's `unassigned` filter), self-card safety guard for both the two new buttons (Task 1's `TeamColumn`/`UnassignedPanel` guards) and Role editing (Task 2), deletion of `AgentManager.tsx`/`ManageTeamsModal.tsx` (Task 4) — every element of the approved design doc (`docs/superpowers/specs/2026-08-09-admin-agents-board-redesign-design.md`) is covered.

**Placeholder scan:** No TBD/TODO markers. Every step includes the literal code to write. Tasks 1-2's two "expected" compile errors are explicitly disclosed and explained, resolved by name in Task 3 — not a silent placeholder.

**Type consistency:** `onAssignShift?: (personId: string, fullName: string) => void` and `onToggleActive?: (personId: string, isActive: boolean) => void` are spelled identically (same names, same parameter types) across `PersonCard.tsx`, `TeamColumn.tsx`, `UnassignedPanel.tsx`, and `TeamLeadersBoard.tsx`. `currentUserId` is a required `string` on `TeamColumn`/`UnassignedPanel` (Task 1) and already existed as a required `string` on `TeamLeadersBoard` and an optional `string` addition on `EditPersonModal` (Task 2) — no drift between tasks. `AssignShiftModal`'s existing prop names (`profileId`, `profileName`, `shiftTemplates`, `currentUserId`) are reused exactly as already defined in that file, not renamed.
