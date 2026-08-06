# Console Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `admin` and `management` users a draggable/resizable/minimizable windowed "console desktop" on `/dashboard`, while leaving the `agent` experience pixel-identical to today.

**Architecture:** `app/(app)/dashboard/page.tsx` keeps its existing single data-fetch, then branches on `profile.role`. The `agent` branch renders the same content as today (now extracted into a reusable `DashboardContent` component). The `admin`/`management` branch renders a new `ConsoleDesktop` client component that owns window state (position/size/z-index/status) and composes a generic `Window` frame around three console-content components (`TeamleadersConsole`, `AgentsConsole`, `ManagementConsole`). A `Dock` provides the only way to reopen a minimized/closed window.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4 (existing dark-mode `dark:` convention), `animejs` v4.4.1 (already a dependency, root-level `animate()` API), Supabase (`@supabase/ssr`).

## Global Constraints

- No automated test suite exists in this project (confirmed in `CLAUDE.md`) — every task's verification step is manual (`npm run dev`, log in as the specified role, confirm in the browser) plus `npx tsc --noEmit` and `npm run lint` for type/lint correctness. There is no "write failing test" step in this plan; do not invent one.
- Spec source of truth: `docs/superpowers/specs/2026-08-06-console-desktop-design.md`. If any task here seems to contradict it, the spec wins — stop and flag it rather than guessing.
- `profiles.role` check constraint already includes `'management'` (migration `supabase/add-management-role.sql` has been run). The `admin` role is NOT renamed — "Teamleader" is a UI/feature label only, per the spec's Section "Roles & landing behavior".
- Window behavior is drag + resize + minimize + close + focus-on-click. No maximize button, no cross-session persistence (window state resets on every page load) — both explicitly out of scope per spec.
- `animejs` v4 API: `import { animate } from 'animejs'; animate(domNode, { opacity: [...], scale: [...], duration, delay, ease: 'outQuad' | 'inQuad', onComplete })`. This is NOT the v3 `anime({ targets, ... })` API — do not use v3 syntax.
- Follow existing Tailwind conventions exactly: `bg-white dark:bg-gray-900`, `border border-gray-100 dark:border-gray-800`, `rounded-xl`, `shadow-sm` for panel chrome (see `components/dashboard/DashboardContent.tsx` after Task 2, or any card in `app/(app)/admin/page.tsx` for reference).
- Path alias `@/` maps to the `CMS/` root (e.g. `@/types`, `@/components/...`) — used throughout the existing codebase.

---

### Task 1: Shared types and window configuration

**Files:**
- Modify: `types/index.ts:1`
- Create: `components/console/types.ts`
- Create: `components/console/windowConfig.ts`

**Interfaces:**
- Consumes: nothing (foundational task).
- Produces: `Role` type now includes `'management'`. `ConsoleKind = 'teamleader' | 'agents' | 'management'`, `WindowStatus = 'open' | 'minimized' | 'closed'`, `WindowConfig`, `WindowState` (extends `WindowConfig` with `x, y, width, height, zIndex, status`). `getWindowConfigs(role: 'admin' | 'management'): WindowConfig[]` and `buildInitialWindowStates(role: 'admin' | 'management'): WindowState[]`. All later tasks importing window types/config use these exact names.

- [ ] **Step 1: Update the `Role` type**

In `types/index.ts:1`, change:

```ts
export type Role = 'agent' | 'admin'
```

to:

```ts
export type Role = 'agent' | 'admin' | 'management'
```

- [ ] **Step 2: Create the window types file**

Create `components/console/types.ts`:

```ts
export type ConsoleKind = 'teamleader' | 'agents' | 'management'
export type WindowStatus = 'open' | 'minimized' | 'closed'

export interface WindowConfig {
  id: string
  kind: ConsoleKind
  title: string
  defaultX: number
  defaultY: number
  defaultWidth: number
  defaultHeight: number
  entryDelayMs: number
}

export interface WindowState extends WindowConfig {
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  status: WindowStatus
}
```

- [ ] **Step 3: Create the window configuration builder**

Create `components/console/windowConfig.ts`:

```ts
import { WindowConfig, WindowState } from './types'

export function getWindowConfigs(role: 'admin' | 'management'): WindowConfig[] {
  const configs: WindowConfig[] = [
    { id: 'teamleader-1', kind: 'teamleader', title: 'Teamleaders', defaultX: 40, defaultY: 32, defaultWidth: 560, defaultHeight: 420, entryDelayMs: 0 },
    { id: 'teamleader-2', kind: 'teamleader', title: 'Teamleaders', defaultX: 620, defaultY: 32, defaultWidth: 560, defaultHeight: 420, entryDelayMs: 40 },
    { id: 'agents-1', kind: 'agents', title: 'Agents', defaultX: 40, defaultY: 480, defaultWidth: 400, defaultHeight: 320, entryDelayMs: 80 },
    { id: 'agents-2', kind: 'agents', title: 'Agents', defaultX: 460, defaultY: 480, defaultWidth: 400, defaultHeight: 320, entryDelayMs: 120 },
  ]

  if (role === 'management') {
    configs.push({ id: 'management', kind: 'management', title: 'Management', defaultX: 880, defaultY: 480, defaultWidth: 480, defaultHeight: 360, entryDelayMs: 160 })
  }

  return configs
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

Note: `admin` and `management` both get the same 4 base windows (2 `teamleader` + 2 `agents`); `management` additionally gets the 5th (`management` kind). This matches the two Dock entries per repeated kind looking identical (same icon/label twice) — that's intentional, not a bug, since both windows of a kind are meant to look the same right now.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expect no errors from these two new files or the `types/index.ts` change.
Run: `npm run lint` — expect no new errors.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts components/console/types.ts components/console/windowConfig.ts
git commit -m "feat: add management role and console window types/config"
```

---

### Task 2: Extract `DashboardContent` from the dashboard page (pure refactor)

**Files:**
- Create: `components/dashboard/DashboardContent.tsx`
- Modify: `app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `Callback`, `Followup` from `@/types` (existing).
- Produces: `DashboardStat` interface and `DashboardContentProps` interface, both exported from `components/dashboard/DashboardContent.tsx`. `DashboardContentProps = { stats: DashboardStat[], pendingCallbacks: Callback[], openFollowups: Followup[], urgentFollowups: Followup[] }`. Task 3's `TeamleadersConsole` and Task 6's `ConsoleDesktop` both import this exact type.

- [ ] **Step 1: Create `DashboardContent`**

Create `components/dashboard/DashboardContent.tsx` with exactly the stats-grid / callbacks-panel / follow-ups-panel / urgent-banner JSX that currently lives inline in `app/(app)/dashboard/page.tsx`:

```tsx
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Phone, FileText, CheckCircle, Clock, AlertTriangle, type LucideIcon } from 'lucide-react'
import { Callback, Followup } from '@/types'

export interface DashboardStat {
  label: string
  value: number
  icon: LucideIcon
  color: string
  href: string
}

export interface DashboardContentProps {
  stats: DashboardStat[]
  pendingCallbacks: Callback[]
  openFollowups: Followup[]
  urgentFollowups: Followup[]
}

export default function DashboardContent({ stats, pendingCallbacks, openFollowups, urgentFollowups }: DashboardContentProps) {
  return (
    <div className="p-6 space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color, href }) => (
          <Link key={label} href={href} className="bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <div className={`${color} rounded-lg p-2`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <span className="text-3xl font-bold text-gray-900 dark:text-white">{value}</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">{label}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Callbacks */}
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Phone className="w-4 h-4 text-amber-500" />
              Upcoming Callbacks
            </h2>
            <Link href="/callbacks" className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">View all</Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {pendingCallbacks.slice(0, 5).length === 0 ? (
              <div className="px-5 py-8 text-center">
                <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No pending callbacks</p>
              </div>
            ) : (
              pendingCallbacks.slice(0, 5).map(cb => (
                <div key={cb.id} className="px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{(cb.customers as any)?.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{(cb.customers as any)?.phone}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-1">{cb.query_description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <Clock className="w-3.5 h-3.5 text-amber-500 ml-auto mb-0.5" />
                      <p className="text-xs text-gray-500 dark:text-gray-400">{formatDistanceToNow(new Date(cb.scheduled_at), { addSuffix: true })}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Open Follow-ups */}
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-500" />
              Open Follow-ups
            </h2>
            <Link href="/followups" className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">View all</Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {openFollowups.slice(0, 5).length === 0 ? (
              <div className="px-5 py-8 text-center">
                <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No open follow-ups</p>
              </div>
            ) : (
              openFollowups.slice(0, 5).map(fu => (
                <div key={fu.id} className="px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{(fu.customers as any)?.name}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          fu.type === 'escalation' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                        }`}>{fu.type}</span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1">{fu.query_description}</p>
                    </div>
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                      fu.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                      fu.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{fu.priority}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {urgentFollowups.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
            <h3 className="font-semibold text-red-800 dark:text-red-300 text-sm">Urgent Items Requiring Attention</h3>
          </div>
          <div className="space-y-1">
            {urgentFollowups.map(fu => (
              <p key={fu.id} className="text-sm text-red-700 dark:text-red-400">
                {(fu.customers as any)?.name} — {fu.query_description}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update `dashboard/page.tsx` to use it**

Replace the full contents of `app/(app)/dashboard/page.tsx` with:

```tsx
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import DashboardContent, { DashboardStat } from '@/components/dashboard/DashboardContent'
import { Phone, FileText, Users, AlertTriangle } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: profile },
    { data: callbacks },
    { data: followups },
    { data: customers },
    { data: notifications },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user!.id).single(),
    supabase.from('callbacks').select('*, customers(name, phone)').eq('agent_id', user!.id).order('scheduled_at', { ascending: true }),
    supabase.from('followups').select('*, customers(name, phone)').eq('agent_id', user!.id).order('created_at', { ascending: false }),
    supabase.from('customers').select('id').eq('created_by', user!.id),
    supabase.from('notifications').select('id').eq('recipient_id', user!.id).eq('read', false),
  ])

  const pendingCallbacks = callbacks?.filter(c => c.status === 'pending') || []
  const openFollowups = followups?.filter(f => ['open', 'in_progress'].includes(f.status)) || []
  const urgentFollowups = followups?.filter(f => f.priority === 'urgent' && f.status !== 'resolved') || []

  const stats: DashboardStat[] = [
    { label: 'My Customers', value: customers?.length || 0, icon: Users, color: 'bg-blue-500', href: '/customers' },
    { label: 'Pending Callbacks', value: pendingCallbacks.length, icon: Phone, color: 'bg-amber-500', href: '/callbacks' },
    { label: 'Open Follow-ups', value: openFollowups.length, icon: FileText, color: 'bg-indigo-500', href: '/followups' },
    { label: 'Unread Alerts', value: notifications?.length || 0, icon: AlertTriangle, color: 'bg-red-500', href: '#' },
  ]

  return (
    <div>
      <Header title={`Welcome back, ${profile?.full_name?.split(' ')[0]}`} userId={user!.id} userRole={profile?.role} />
      <DashboardContent
        stats={stats}
        pendingCallbacks={pendingCallbacks}
        openFollowups={openFollowups}
        urgentFollowups={urgentFollowups}
      />
    </div>
  )
}
```

This is the intermediate state — role branching is introduced in Task 7. Right now every role sees this same output, identical to before the refactor.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors.
Run: `npm run dev`, log in as `agent@carecms.local` / `Agent123!` (seeded by `npm run setup:users`), open `/dashboard`. Confirm it looks and behaves exactly as before this change (stat cards, callbacks panel, follow-ups panel, urgent banner if applicable).

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/DashboardContent.tsx "app/(app)/dashboard/page.tsx"
git commit -m "refactor: extract DashboardContent from dashboard page"
```

---

### Task 3: Console content components (placeholders + Teamleaders wrapper)

**Files:**
- Create: `components/console/EmptyConsoleContent.tsx`
- Create: `components/console/AgentsConsole.tsx`
- Create: `components/console/ManagementConsole.tsx`
- Create: `components/console/TeamleadersConsole.tsx`

**Interfaces:**
- Consumes: `DashboardContentProps` from `components/dashboard/DashboardContent.tsx` (Task 2).
- Produces: `AgentsConsole` (no props), `ManagementConsole` (no props), `TeamleadersConsole(props: DashboardContentProps)` — all default exports, all render a `h-full w-full`-filling body with no internal scrolling assumptions beyond what `Window`'s content area (Task 4) provides. Task 6 (`ConsoleDesktop`) renders all three by kind.

- [ ] **Step 1: Create the shared empty-state content**

Create `components/console/EmptyConsoleContent.tsx`:

```tsx
import { Construction } from 'lucide-react'

export interface EmptyConsoleContentProps {
  label: string
}

export default function EmptyConsoleContent({ label }: EmptyConsoleContentProps) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-center p-6">
      <div className="bg-gray-100 dark:bg-gray-800 rounded-full p-4 mb-4">
        <Construction className="w-6 h-6 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label} console</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Coming soon</p>
    </div>
  )
}
```

- [ ] **Step 2: Create `AgentsConsole` and `ManagementConsole`**

Create `components/console/AgentsConsole.tsx`:

```tsx
import EmptyConsoleContent from './EmptyConsoleContent'

export default function AgentsConsole() {
  return <EmptyConsoleContent label="Agents" />
}
```

Create `components/console/ManagementConsole.tsx`:

```tsx
import EmptyConsoleContent from './EmptyConsoleContent'

export default function ManagementConsole() {
  return <EmptyConsoleContent label="Management" />
}
```

- [ ] **Step 3: Create `TeamleadersConsole`**

Create `components/console/TeamleadersConsole.tsx`:

```tsx
import DashboardContent, { DashboardContentProps } from '@/components/dashboard/DashboardContent'

export default function TeamleadersConsole(props: DashboardContentProps) {
  return <DashboardContent {...props} />
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors. These components aren't wired into a route yet (that happens in Task 7), so visual verification is deferred to Task 8's full QA pass — don't build a throwaway test page for this.

- [ ] **Step 5: Commit**

```bash
git add components/console/EmptyConsoleContent.tsx components/console/AgentsConsole.tsx components/console/ManagementConsole.tsx components/console/TeamleadersConsole.tsx
git commit -m "feat: add console content components (Agents, Management, Teamleaders)"
```

---

### Task 4: The `Window` component (drag, resize, minimize, close, focus, animation)

**Files:**
- Create: `components/console/Window.tsx`

**Interfaces:**
- Consumes: `WindowState` from `components/console/types.ts` (Task 1); `animate` from `animejs`.
- Produces: `Window` component with props `{ state: WindowState, children: React.ReactNode, onDrag: (x: number, y: number) => void, onResize: (width: number, height: number) => void, onFocus: () => void, onMinimize: () => void, onClose: () => void }`. Task 6 (`ConsoleDesktop`) is the only consumer.

- [ ] **Step 1: Create `Window`**

Create `components/console/Window.tsx`:

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { Minus, X } from 'lucide-react'
import { animate } from 'animejs'
import { WindowState } from './types'

export interface WindowProps {
  state: WindowState
  children: React.ReactNode
  onDrag: (x: number, y: number) => void
  onResize: (width: number, height: number) => void
  onFocus: () => void
  onMinimize: () => void
  onClose: () => void
}

const MIN_WIDTH = 320
const MIN_HEIGHT = 240

export default function Window({ state, children, onDrag, onResize, onFocus, onMinimize, onClose }: WindowProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null)
  const resizeOrigin = useRef<{ pointerX: number; pointerY: number; startWidth: number; startHeight: number } | null>(null)

  useEffect(() => {
    const node = rootRef.current
    if (!node) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return

    animate(node, {
      opacity: [0, 1],
      scale: [0.9, 1],
      duration: 200,
      delay: state.entryDelayMs,
      ease: 'outQuad',
    })
    // Intentionally mount-only: every open/reopen of a window is a fresh mount of this
    // component (ConsoleDesktop only renders windows with status === 'open'), so re-running
    // this on prop changes would replay the entrance animation on every drag/resize update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function playExitAnimation(after: () => void) {
    const node = rootRef.current
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!node || reduceMotion) {
      after()
      return
    }
    animate(node, {
      opacity: [1, 0],
      scale: [1, 0.9],
      duration: 150,
      ease: 'inQuad',
      onComplete: after,
    })
  }

  function handleTitlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    onFocus()
    dragOrigin.current = { pointerX: e.clientX, pointerY: e.clientY, startX: state.x, startY: state.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleTitlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragOrigin.current) return
    const dx = e.clientX - dragOrigin.current.pointerX
    const dy = e.clientY - dragOrigin.current.pointerY
    onDrag(Math.max(0, dragOrigin.current.startX + dx), Math.max(0, dragOrigin.current.startY + dy))
  }

  function handleTitlePointerUp() {
    dragOrigin.current = null
  }

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation()
    onFocus()
    resizeOrigin.current = { pointerX: e.clientX, pointerY: e.clientY, startWidth: state.width, startHeight: state.height }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizeOrigin.current) return
    const dx = e.clientX - resizeOrigin.current.pointerX
    const dy = e.clientY - resizeOrigin.current.pointerY
    onResize(
      Math.max(MIN_WIDTH, resizeOrigin.current.startWidth + dx),
      Math.max(MIN_HEIGHT, resizeOrigin.current.startHeight + dy),
    )
  }

  function handleResizePointerUp() {
    resizeOrigin.current = null
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={state.title}
      onPointerDown={onFocus}
      className="absolute flex flex-col bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden"
      style={{ left: state.x, top: state.y, width: state.width, height: state.height, zIndex: state.zIndex }}
    >
      <div
        onPointerDown={handleTitlePointerDown}
        onPointerMove={handleTitlePointerMove}
        onPointerUp={handleTitlePointerUp}
        className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 cursor-move select-none shrink-0"
      >
        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{state.title}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => playExitAnimation(onMinimize)}
            aria-label={`Minimize ${state.title}`}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => playExitAnimation(onClose)}
            aria-label={`Close ${state.title}`}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {children}
      </div>

      <div
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        aria-hidden="true"
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors. Not wired into a route yet — interactive verification (drag/resize/minimize/close/focus) happens in Task 8 once `ConsoleDesktop` (Task 6) and the page wiring (Task 7) exist.

- [ ] **Step 3: Commit**

```bash
git add components/console/Window.tsx
git commit -m "feat: add draggable/resizable/minimizable Window component"
```

---

### Task 5: The `Dock` component

**Files:**
- Create: `components/console/Dock.tsx`

**Interfaces:**
- Consumes: `WindowState`, `ConsoleKind` from `components/console/types.ts` (Task 1).
- Produces: `Dock` component with props `{ windows: WindowState[], onIconClick: (id: string) => void }`. Task 6 (`ConsoleDesktop`) is the only consumer.

- [ ] **Step 1: Create `Dock`**

Create `components/console/Dock.tsx`:

```tsx
'use client'

import { LayoutDashboard, Users, Building2 } from 'lucide-react'
import { ConsoleKind, WindowState } from './types'

const ICONS: Record<ConsoleKind, typeof LayoutDashboard> = {
  teamleader: LayoutDashboard,
  agents: Users,
  management: Building2,
}

export interface DockProps {
  windows: WindowState[]
  onIconClick: (id: string) => void
}

export default function Dock({ windows, onIconClick }: DockProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-2 px-4 py-3 bg-gray-900/95 dark:bg-black/60 border-t border-gray-800 backdrop-blur">
      {windows.map(w => {
        const Icon = ICONS[w.kind]
        const isOpen = w.status === 'open'
        const isMinimized = w.status === 'minimized'
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onIconClick(w.id)}
            aria-label={`Open ${w.title}`}
            className={`relative flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
              isOpen ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{w.title}</span>
            {(isOpen || isMinimized) && (
              <span className={`absolute -bottom-0.5 w-1 h-1 rounded-full ${isOpen ? 'bg-blue-400' : 'bg-gray-500'}`} />
            )}
          </button>
        )
      })}
    </div>
  )
}
```

Note: two `teamleader`-kind windows and two `agents`-kind windows will render as two visually-identical Dock buttons each (same icon + same label). That's expected — it mirrors there being two windows of the same console type.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors. Visual/interactive verification deferred to Task 8.

- [ ] **Step 3: Commit**

```bash
git add components/console/Dock.tsx
git commit -m "feat: add Dock component for reopening minimized/closed windows"
```

---

### Task 6: `ConsoleDesktop` — ties window state, Dock, Window, and console content together

**Files:**
- Create: `components/console/ConsoleDesktop.tsx`

**Interfaces:**
- Consumes: `WindowState`, `buildInitialWindowStates` (Task 1); `Window` (Task 4); `Dock` (Task 5); `TeamleadersConsole`, `AgentsConsole`, `ManagementConsole` (Task 3); `DashboardContentProps` (Task 2).
- Produces: `ConsoleDesktop` component with props `{ role: 'admin' | 'management', dashboardData: DashboardContentProps }`. Task 7 (`dashboard/page.tsx`) is the only consumer.

- [ ] **Step 1: Create `ConsoleDesktop`**

Create `components/console/ConsoleDesktop.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { WindowState } from './types'
import { buildInitialWindowStates } from './windowConfig'
import Window from './Window'
import Dock from './Dock'
import TeamleadersConsole from './TeamleadersConsole'
import AgentsConsole from './AgentsConsole'
import ManagementConsole from './ManagementConsole'
import { DashboardContentProps } from '@/components/dashboard/DashboardContent'

export interface ConsoleDesktopProps {
  role: 'admin' | 'management'
  dashboardData: DashboardContentProps
}

export default function ConsoleDesktop({ role, dashboardData }: ConsoleDesktopProps) {
  const [windows, setWindows] = useState<WindowState[]>(() => buildInitialWindowStates(role))

  function updateWindow(id: string, patch: Partial<WindowState>) {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)))
  }

  function focusWindow(id: string) {
    setWindows(prev => {
      const maxZ = Math.max(...prev.map(w => w.zIndex))
      return prev.map(w => (w.id === id ? { ...w, zIndex: maxZ + 1 } : w))
    })
  }

  function setStatus(id: string, status: WindowState['status']) {
    updateWindow(id, { status })
    if (status === 'open') focusWindow(id)
  }

  function renderConsole(w: WindowState) {
    switch (w.kind) {
      case 'teamleader':
        return <TeamleadersConsole {...dashboardData} />
      case 'agents':
        return <AgentsConsole />
      case 'management':
        return <ManagementConsole />
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-gray-50 dark:bg-gray-950">
      {windows
        .filter(w => w.status === 'open')
        .map(w => (
          <Window
            key={w.id}
            state={w}
            onDrag={(x, y) => updateWindow(w.id, { x, y })}
            onResize={(width, height) => updateWindow(w.id, { width, height })}
            onFocus={() => focusWindow(w.id)}
            onMinimize={() => setStatus(w.id, 'minimized')}
            onClose={() => setStatus(w.id, 'closed')}
          >
            {renderConsole(w)}
          </Window>
        ))}
      <Dock windows={windows} onIconClick={id => setStatus(id, 'open')} />
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors. Not wired into the route yet — full verification happens in Task 8.

- [ ] **Step 3: Commit**

```bash
git add components/console/ConsoleDesktop.tsx
git commit -m "feat: add ConsoleDesktop composing Window/Dock/console content by role"
```

---

### Task 7: Wire `/dashboard` to branch by role

**Files:**
- Modify: `app/(app)/dashboard/page.tsx` (the version from Task 2)

**Interfaces:**
- Consumes: `ConsoleDesktop` (Task 6), `DashboardContent`/`DashboardStat` (Task 2).
- Produces: final `/dashboard` route behavior — no further tasks depend on this one besides QA.

- [ ] **Step 1: Add the role branch**

Replace the full contents of `app/(app)/dashboard/page.tsx` with:

```tsx
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import DashboardContent, { DashboardStat } from '@/components/dashboard/DashboardContent'
import ConsoleDesktop from '@/components/console/ConsoleDesktop'
import { Phone, FileText, Users, AlertTriangle } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: profile },
    { data: callbacks },
    { data: followups },
    { data: customers },
    { data: notifications },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user!.id).single(),
    supabase.from('callbacks').select('*, customers(name, phone)').eq('agent_id', user!.id).order('scheduled_at', { ascending: true }),
    supabase.from('followups').select('*, customers(name, phone)').eq('agent_id', user!.id).order('created_at', { ascending: false }),
    supabase.from('customers').select('id').eq('created_by', user!.id),
    supabase.from('notifications').select('id').eq('recipient_id', user!.id).eq('read', false),
  ])

  const pendingCallbacks = callbacks?.filter(c => c.status === 'pending') || []
  const openFollowups = followups?.filter(f => ['open', 'in_progress'].includes(f.status)) || []
  const urgentFollowups = followups?.filter(f => f.priority === 'urgent' && f.status !== 'resolved') || []

  const stats: DashboardStat[] = [
    { label: 'My Customers', value: customers?.length || 0, icon: Users, color: 'bg-blue-500', href: '/customers' },
    { label: 'Pending Callbacks', value: pendingCallbacks.length, icon: Phone, color: 'bg-amber-500', href: '/callbacks' },
    { label: 'Open Follow-ups', value: openFollowups.length, icon: FileText, color: 'bg-indigo-500', href: '/followups' },
    { label: 'Unread Alerts', value: notifications?.length || 0, icon: AlertTriangle, color: 'bg-red-500', href: '#' },
  ]

  if (profile?.role === 'admin' || profile?.role === 'management') {
    return (
      <div className="h-full">
        <ConsoleDesktop
          role={profile.role}
          dashboardData={{ stats, pendingCallbacks, openFollowups, urgentFollowups }}
        />
      </div>
    )
  }

  return (
    <div>
      <Header title={`Welcome back, ${profile?.full_name?.split(' ')[0]}`} userId={user!.id} userRole={profile?.role} />
      <DashboardContent
        stats={stats}
        pendingCallbacks={pendingCallbacks}
        openFollowups={openFollowups}
        urgentFollowups={urgentFollowups}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors.
Run: `npm run dev`. Log in as `agent@carecms.local` — confirm `/dashboard` is unchanged (Header + stats/panels, no windows/Dock).
Log in as `tylin.moodley@carecms.local` (role `management`) — confirm the windowed desktop renders with a Dock at the bottom.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/dashboard/page.tsx"
git commit -m "feat: branch /dashboard to ConsoleDesktop for admin/management roles"
```

---

### Task 8: Full manual QA pass across roles and themes

**Files:** none (verification only — no code changes expected; if QA finds a bug, fix it in the relevant file from Tasks 1–7 and commit that fix separately with a clear message).

**Interfaces:** N/A.

- [ ] **Step 1: Agent role — confirm zero change**

`npm run dev`, log in as `agent@carecms.local` / `Agent123!`. Confirm `/dashboard` looks and behaves exactly as it did before this feature (no windows, no Dock).

- [ ] **Step 2: Admin role — confirm 4 windows**

Log in as `admin@carecms.local` / `Admin123!`. Confirm exactly 4 windows appear on load (2 "Teamleaders" showing the dashboard stats/panels, 2 "Agents" showing "Coming soon"), and the Dock shows exactly 4 icons — no "Management" icon anywhere.

- [ ] **Step 3: Management role — confirm 5 windows**

Log in as `tylin.moodley@carecms.local`. Confirm all 5 windows appear (2 Teamleaders, 2 Agents, 1 Management — the Management window using its larger default size: 480×360 vs. 400×320 for Agents), and the Dock shows exactly 5 icons.

- [ ] **Step 4: Interaction check (repeat for at least one window of each kind)**

- Drag: pointer-down on a title bar and move — window follows the cursor, never left of/above the desktop edge (position clamps at 0).
- Resize: drag the bottom-right corner handle — window grows/shrinks, never below 320×240.
- Focus: click a background window — its z-index brings it above the others.
- Minimize: click the minimize button — window fades/scales out, disappears from the desktop; its Dock icon shows a dim indicator dot (not the bright "open" one).
- Close: click the close button — same visual behavior as minimize (expected, per spec).
- Reopen: click that window's Dock icon — it fades/scales back in at its last position/size and focuses to the front.

- [ ] **Step 5: Theme check**

Toggle dark/light mode (via the Sidebar's theme toggle, on a page where the Sidebar is visible — note the console desktop itself doesn't show the Sidebar's theme toggle inside a window, so toggle before or after navigating to `/dashboard`). Confirm the desktop background, window chrome, title bar, Dock, and both console content types (DashboardContent and the empty placeholders) all read correctly in both themes.

- [ ] **Step 6: Reduced motion check**

In the browser/OS, enable "reduce motion" (e.g. Chrome DevTools → Rendering tab → "Emulate CSS media feature prefers-reduced-motion: reduce"). Reload `/dashboard` as `management`. Confirm windows appear instantly (no fade/scale-in), and minimize/close hide instantly with no animation.

- [ ] **Step 7: Final commit (only if QA fixes were made)**

If Steps 1–6 required any code fixes, ensure each fix was already committed individually with a message describing the specific bug fixed. If everything passed with no changes needed, there is nothing to commit for this task.

---

## Plan Self-Review

**Spec coverage:** Role/routing behavior (Task 7), component structure incl. `EmptyConsoleContent` reuse (Tasks 3, 6), window state model (Task 1), drag/resize/minimize/close/focus/reopen (Task 4, 5, 6), known Teamleaders data-scoping limitation (documented in spec, inherited automatically since Task 6 passes through the same query results — no separate task needed, it's a non-change), theming (Tasks 2–6 all reuse existing Tailwind classes), motion incl. reduced-motion (Task 4), manual testing (Task 8) — all covered.

**Placeholder scan:** No TBD/TODO markers; every step has complete, runnable code; no "similar to Task N" shortcuts — each task's code is written in full even where similar to another task's.

**Type consistency:** `WindowState`/`WindowConfig`/`ConsoleKind`/`WindowStatus` (Task 1) are used with identical field names in `Window` (Task 4: `state.x/y/width/height/zIndex/status/title/entryDelayMs`), `Dock` (Task 5: `w.kind/status/title`), and `ConsoleDesktop` (Task 6: same). `DashboardContentProps`/`DashboardStat` (Task 2) match the props passed in Task 7 (`stats`, `pendingCallbacks`, `openFollowups`, `urgentFollowups`) and the spread in `TeamleadersConsole` (Task 3) and `ConsoleDesktop` (Task 6). `role: 'admin' | 'management'` is consistent across `ConsoleDesktop`, `windowConfig.ts`, and the `dashboard/page.tsx` branch condition.
