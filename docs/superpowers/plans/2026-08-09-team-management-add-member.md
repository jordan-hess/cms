# Team Management Add-Member Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `management`-role users the same "create a brand-new person" capability that exists today on the admin-only "Manage Agents" page, as an "Add Team Member" button on the Team Leaders Management board, and rename that page's visible title to "Team Management".

**Architecture:** Extract the admin page's inline account-creation form (`AgentManager.tsx`) into a standalone `AddTeamMemberModal` component, matching the existing one-modal-per-file convention in `components/team-leaders/`. Both the admin page and the Team Leaders Management board render the same component. The only backend change is widening the single explicit role check in `/api/admin/create-user/route.ts` (a service-role route that bypasses RLS entirely) to also accept `management` — no RLS policy or SQL migration needed.

**Tech Stack:** Next.js 16 App Router, React, Tailwind, `lucide-react`. No new dependencies.

## Global Constraints

- No automated test suite exists in this project (confirmed in `CLAUDE.md`) — every task's "verify" step is a manual/live check, consistent with every other feature in this codebase.
- The role dropdown in the create-account modal stays **Agent or Admin** for both callers — no restriction for the management-page caller. This was an explicit decision during design: full parity with the admin page, not a cut-down version.
- The extracted `AddTeamMemberModal` must preserve the admin page's exact current behavior: on success, the modal stays open, shows a green success message, and resets the form (role back to `'agent'`) — it does NOT close itself. This lets someone create several accounts in a row without reopening the modal. Do not "improve" this to close-on-success; that would be an unrequested behavior change to existing admin functionality.
- `/api/admin/create-user/route.ts` uses a service-role Supabase client for everything past its own auth check — there is no RLS policy to widen for this task. The only gate is the explicit `if (profile?.role !== 'admin')` check.
- The page's URL stays `/team-leaders` — only the visible title (page `<Header>`) and the Sidebar's `management`-branch nav label change to "Team Management". `proxy.ts`'s gate, the route folder name, and all internal links are unchanged.
- Button placement: "Add Team Member" goes to the left of the existing "Add Team" button, in the same `flex justify-end` row in `components/team-leaders/TeamLeadersBoard.tsx`.

---

### Task 1: Widen the create-user route's role gate

**Files:**
- Modify: `app/api/admin/create-user/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: after this task, a request to `POST /api/admin/create-user` from a session whose `profiles.role` is `'management'` passes the auth check (previously 403). `'agent'` sessions must still be rejected with 403.

- [ ] **Step 1: Widen the check**

In `app/api/admin/create-user/route.ts`, change:

```ts
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
```

to:

```ts
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single()
  if (profile?.role !== 'admin' && profile?.role !== 'management') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
```

Nothing else in this file changes — the rest of the route (service-role client, email-uniqueness check, password hashing, profile insert) is unaffected and already works for any role value passed in the request body.

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors.

Manual check: log in as `admin`, confirm the admin "Manage Agents" page's existing "Add Team Member" flow still works (create a test account, confirm success). This route change is additive (widens who's *allowed*, never who's *blocked*), so this is a regression check, not new functionality — the management-role path can't be exercised end-to-end until Task 3 adds a UI for it, but this route can already be verified independently of that UI (e.g. via a direct authenticated request), which the controller will do after this task.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/create-user/route.ts
git commit -m "feat: allow management role to create new team member accounts"
```

---

### Task 2: Extract `AddTeamMemberModal`, refactor `AgentManager` to use it

**Files:**
- Create: `components/team-leaders/AddTeamMemberModal.tsx`
- Modify: `components/admin/AgentManager.tsx`

**Interfaces:**
- Consumes: `Modal` from `@/components/ui/Modal` (same component `AgentManager.tsx` already uses).
- Produces: `AddTeamMemberModal` — default export, props `{ open: boolean; onClose: () => void; onSuccess: () => void }`. `onSuccess` is called once after a successful account creation (the modal does NOT close itself or call `router.refresh()` — that's the caller's job, matching how `AddTeamModal.tsx` already works). Task 3 imports this same component into `TeamLeadersBoard.tsx`.

- [ ] **Step 1: Create `AddTeamMemberModal`**

Create `components/team-leaders/AddTeamMemberModal.tsx` — this is `AgentManager.tsx`'s current inline modal (lines 236-280 of the pre-refactor file), lifted out with its own local state instead of reading/writing the parent's:

```tsx
'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function AddTeamMemberModal({ open, onClose, onSuccess }: Props) {
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'agent', department: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Failed to create user')
    } else {
      setSuccess(`${form.role === 'admin' ? 'Admin' : 'Agent'} ${form.full_name} created successfully`)
      setForm({ email: '', full_name: '', password: '', role: 'agent', department: '' })
      onSuccess()
    }
    setSaving(false)
  }

  function handleClose() {
    setError('')
    setSuccess('')
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Team Member">
      <form onSubmit={handleInvite} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name *</label>
          <input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
          <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
          <input required type="password" minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            placeholder="Min 8 characters" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="e.g. Sales" />
          </div>
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{success}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={handleClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-medium">
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            {saving ? 'Creating...' : 'Create Account'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

Note the added `handleClose` wrapper: the original inline version implicitly cleared `error`/`success` on reopen because `setModal(true)` was paired with `setError(''); setSuccess('')` at the call site (`AgentManager.tsx`'s button `onClick`). Since this component now owns that state itself, clearing it on close (rather than on reopen) achieves the same visible result — a fresh modal next time it opens — without requiring every caller to remember to reset it.

- [ ] **Step 2: Refactor `AgentManager.tsx` to use it**

In `components/admin/AgentManager.tsx`:

Add the import:
```ts
import AddTeamMemberModal from '@/components/team-leaders/AddTeamMemberModal'
```

Remove `Loader2` from the existing `lucide-react` import (no longer used directly in this file after the modal markup is removed) — the import line currently reads:
```ts
import { Plus, Shield, User, Mail, Loader2, CheckCircle, XCircle, Clock, Users2, Crown } from 'lucide-react'
```
becomes:
```ts
import { Plus, Shield, User, Mail, CheckCircle, XCircle, Clock, Users2, Crown } from 'lucide-react'
```

Remove these state declarations (no longer needed — they lived in `AddTeamMemberModal` now):
```ts
const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'agent', department: '' })
const [saving, setSaving] = useState(false)
const [error, setError] = useState('')
const [success, setSuccess] = useState('')
```
Keep `const [modal, setModal] = useState(false)` — the parent still owns whether the modal is open.

Remove the entire `handleInvite` function.

Change the "Add Team Member" button's `onClick` from:
```tsx
<button onClick={() => { setModal(true); setError(''); setSuccess('') }}
```
to:
```tsx
<button onClick={() => setModal(true)}
```
(the rest of that button's JSX — className, icon, label — is unchanged).

Replace the entire `<Modal open={modal} ...>...</Modal>` block (the old inline form, currently the last element before the component's closing `</div>`) with:
```tsx
      <AddTeamMemberModal
        open={modal}
        onClose={() => setModal(false)}
        onSuccess={() => router.refresh()}
      />
```

Everything else in `AgentManager.tsx` (the agent list, `AssignShiftModal`, `AssignTeamModal`, `AssignTeamLeaderModal`, `ManageTeamsModal`, `toggleActive`, `changeRole`, etc.) is unchanged.

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors.

Manual check, logged in as `admin`, on the "Manage Agents" page:
1. Click "Add Team Member" — confirm the modal opens with empty fields.
2. Create a new agent account (fill all fields, Role = Agent). Confirm: the modal stays open, shows the green "Agent \<name\> created successfully" message, the form fields clear back to blank (role back to "Agent"), and the new person appears in the agent list after it re-renders.
3. Create a second account with Role = Admin in the same session without closing the modal — confirm both work back-to-back.
4. Trigger an error (e.g. reuse an email you just created) — confirm the red error message shows and the modal does NOT clear the form (so the user can fix and resubmit).
5. Click Cancel — confirm the modal closes. Reopen it — confirm it's back to a clean, empty state (no leftover error/success message from before).

This must behave identically to how it worked before this refactor — report any difference as a regression, not an acceptable side effect.

- [ ] **Step 4: Commit**

```bash
git add components/team-leaders/AddTeamMemberModal.tsx components/admin/AgentManager.tsx
git commit -m "refactor: extract AddTeamMemberModal out of AgentManager for reuse"
```

---

### Task 3: Add the "Add Team Member" button to the Team Leaders Management board

**Files:**
- Modify: `components/team-leaders/TeamLeadersBoard.tsx`

**Interfaces:**
- Consumes: `AddTeamMemberModal` from `./AddTeamMemberModal` (Task 2).
- Produces: a working "Add Team Member" button on the board, visible to `management` users (this page is already gated to `management` only via `app/(app)/team-leaders/layout.tsx`, unchanged by this task).

- [ ] **Step 1: Add the import and state**

In `components/team-leaders/TeamLeadersBoard.tsx`, add the import alongside the existing modal imports:
```ts
import AddTeamMemberModal from './AddTeamMemberModal'
```

Add state alongside the existing `addingTeam` state:
```ts
const [addingTeamMember, setAddingTeamMember] = useState(false)
```

- [ ] **Step 2: Add the button**

The current top-of-board row is:
```tsx
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setAddingTeam(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Team
          </button>
        </div>
```

Change it to (new button added to the left of "Add Team", same styling, same `Plus` icon already imported in this file):
```tsx
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
```

- [ ] **Step 3: Render the modal**

Add, alongside the existing `<AddTeamModal .../>` render (near the end of the component, inside the `<DndContext>`):
```tsx
      <AddTeamMemberModal
        open={addingTeamMember}
        onClose={() => setAddingTeamMember(false)}
        onSuccess={() => router.refresh()}
      />
```

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors.

Manual check, logged in as `management`, on `/team-leaders`:
1. Confirm "Add Team Member" appears to the left of "Add Team".
2. Click it, create a new agent account. Confirm success message, and after the modal's `onSuccess` triggers `router.refresh()`, confirm the new person appears in the board's "unassigned" pool (wherever `TeamColumn`/the board currently surfaces unassigned people — drag them onto a team to confirm they behave like any other person).
3. Create an Admin-role account the same way — confirm it also lands in the unassigned pool (an admin with no team_leaders row is just an unassigned person here, same as an agent).
4. Confirm the modal's error/reset/cancel behavior matches what Task 2 verified on the admin page (same component, same behavior, different page).

- [ ] **Step 5: Commit**

```bash
git add components/team-leaders/TeamLeadersBoard.tsx
git commit -m "feat: add Add Team Member button to the Team Leaders Management board"
```

---

### Task 4: Rename the page to "Team Management"

**Files:**
- Modify: `app/(app)/team-leaders/page.tsx`
- Modify: `components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the page header and Sidebar nav label both read "Team Management" for `management` users. URL, `proxy.ts` gate, and route folder name are unchanged.

- [ ] **Step 1: Update the page header**

In `app/(app)/team-leaders/page.tsx`, change:
```tsx
<Header title="Team Leaders Management" userId={userId!} />
```
to:
```tsx
<Header title="Team Management" userId={userId!} />
```

- [ ] **Step 2: Update the Sidebar label**

In `components/layout/Sidebar.tsx`, change:
```ts
    role === 'management'
      ? { href: '/team-leaders', label: 'Team Leaders Management', icon: Users2 }
      : { href: '/callbacks', label: 'Callbacks', icon: Phone },
```
to:
```ts
    role === 'management'
      ? { href: '/team-leaders', label: 'Team Management', icon: Users2 }
      : { href: '/callbacks', label: 'Callbacks', icon: Phone },
```
(`href` and `icon` are unchanged — only the `label` string.)

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no errors.

Manual check, logged in as `management`: confirm the Sidebar shows "Team Management" (not "Team Leaders Management"), confirm clicking it still goes to `/team-leaders`, and confirm the page's header now reads "Team Management".

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/team-leaders/page.tsx" components/layout/Sidebar.tsx
git commit -m "chore: rename Team Leaders Management page to Team Management"
```

---

### Task 5: Full manual QA pass

**Files:** none (verification only — if QA finds a bug, fix it in the relevant file and commit that fix separately with a clear message).

**Interfaces:** N/A.

- [ ] **Step 1: Cross-role regression check**

Log in as `agent`: confirm `POST /api/admin/create-user` is still rejected (403) for this role — Task 1 only widened the check to include `management`, it must not have loosened it further.

Log in as `admin`: confirm the "Manage Agents" page is functionally unchanged end-to-end (this was already checked in Task 2, but re-confirm now that Tasks 3-4 have also landed, in case anything in the shared component regressed).

- [ ] **Step 2: Full management journey**

Log in as `management`, on `/team-leaders` (labeled "Team Management" in the Sidebar):
1. Create a new agent via "Add Team Member".
2. Drag that new agent onto a team.
3. Confirm they show up correctly as a team member (same as any pre-existing person).

- [ ] **Step 3: Final commit (only if QA fixes were made)**

If Steps 1-2 required any code fixes, commit each individually with a message describing the specific bug fixed. If everything passed with no fixes needed, say so clearly.

---

## Plan Self-Review

**Spec coverage:** Route role-gate widening (Task 1), shared modal extraction with identical admin-page behavior preserved (Task 2), the board button + wiring (Task 3), title/label rename (Task 4), cross-role regression + end-to-end QA (Task 5) — every item from the approved design doc (`docs/superpowers/specs/2026-08-09-team-management-add-member-design.md`) is covered: scope (create-account only, not the other admin buttons), Agent/Admin role parity, button placement next to "Add Team", no RLS migration, title-only rename with the URL unchanged.

**Placeholder scan:** No TBD/TODO markers. Every step includes the literal code to write.

**Type consistency:** `AddTeamMemberModal`'s `{ open, onClose, onSuccess }` props are used identically at both call sites (Task 2's `AgentManager.tsx`, Task 3's `TeamLeadersBoard.tsx`), matching the exact shape already established by `AddTeamModal.tsx` in the same directory. No new types were introduced that could drift between tasks.
