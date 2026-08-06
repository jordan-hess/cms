# Console Desktop — Design Spec

Date: 2026-08-06
Status: Approved for planning

## Overview

Today every logged-in user lands on `/dashboard`, which renders the same stats/callbacks/follow-ups view regardless of role. This adds a role-dependent "windowed desktop" experience for the `admin` and `management` roles: a set of draggable, resizable, minimizable windows (styled to match the app's existing dark/light theme, not a literal OS skin), each hosting a different "console." The `agent` role is untouched.

## Roles & landing behavior

| Role | Landing experience |
|---|---|
| `agent` | Unchanged — today's dashboard content, no windowed desktop. |
| `admin` | Windowed desktop with 4 windows: 2 "Teamleaders" + 2 "Agents". This role is informally called "Teamleader" for this feature, but the underlying `profiles.role` value stays `admin` — no rename of the role slug, no changes to `/admin/*` route access, RLS policies, or existing admin tooling. |
| `management` | Windowed desktop with all 5 windows: 2 "Teamleaders" + 2 "Agents" + 1 "Management". `management` is a new `profiles.role` value (migration already applied via `supabase/add-management-role.sql`). |

Both "Teamleaders" windows show identical content (today's dashboard, reused as-is — see Known Limitation below). Both "Agents" windows and the "Management" window are empty placeholders for now, to be filled in in future iterations.

## Routing

No new route and no `proxy.ts` changes. `app/(app)/dashboard/page.tsx` keeps its existing data-fetching (profile, callbacks, follow-ups, customers, notifications) and branches purely on `profile.role`:

- `agent` → today's JSX, extracted into a `DashboardContent` component but otherwise pixel-identical to what exists now.
- `admin` / `management` → `<ConsoleDesktop role={profile.role} dashboardData={...} />`, passing through the already-fetched data so "Teamleaders" windows don't need a second fetch.

## Component structure

```
components/console/
  ConsoleDesktop.tsx      — owns window state; builds the window list from role
  Dock.tsx                — row of icons, one per window; click toggles open/minimized + focuses
  Window.tsx              — generic draggable/resizable/minimizable frame
  TeamleadersConsole.tsx  — wraps DashboardContent (the extracted today's-dashboard JSX)
  AgentsConsole.tsx       — wraps EmptyConsoleContent (labelled "Agents")
  ManagementConsole.tsx   — wraps EmptyConsoleContent (labelled "Management"), larger default size
  EmptyConsoleContent.tsx — shared placeholder body (icon + label + "Coming soon"), used by both
                            Agents and Management consoles so all three console types follow the
                            same Console-wraps-Content pattern, not just Teamleaders.
```

`ConsoleDesktop` is the only component that knows about roles. `Window` and `Dock` are generic and reusable; they know nothing about what's inside a window.

## Window state model

Each window is:

```ts
{
  id: string            // 'teamleader-1' | 'teamleader-2' | 'agents-1' | 'agents-2' | 'management'
  title: string
  x: number, y: number
  width: number, height: number
  zIndex: number
  status: 'open' | 'minimized' | 'closed'
}
```

State lives in `ConsoleDesktop`'s React state, initialized fresh on every page load (see Out of Scope — no cross-session persistence in this iteration).

## Interaction model

- **Drag**: pointer-down on the title bar starts tracking; position updates via inline `style`; pointer-up ends it.
- **Resize**: a resize handle on the bottom-right corner (cursor `nwse-resize`); dragging adjusts `width`/`height` with a minimum of 320×240px. No maximum clamp beyond keeping the window from being dragged/resized entirely outside the visible desktop area (position/size clamped so the title bar always stays reachable).
- **Focus**: clicking anywhere in a window bumps its `zIndex` above all others.
- **Minimize**: title-bar button sets `status: 'minimized'`. The window disappears from the desktop but keeps its `x/y/width/height` in state.
- **Close**: title-bar button sets `status: 'closed'`. Functionally identical to minimize in this iteration (there's no "destroy" semantics — all 5 windows always exist) but kept as a visually distinct control since that's the expected affordance.
- **Reopen**: the Dock is the only way back. Each of the 5 windows has a permanent Dock icon; clicking it sets `status: 'open'` (restoring the last known position/size) and focuses it. The Dock icon shows a visual indicator (e.g. a filled dot) when its window is open or minimized, vs. plain when closed.

## Known limitation (called out explicitly, not a bug)

The "Teamleaders" console reuses today's dashboard queries, which filter by `.eq('agent_id', user.id)`. For `admin`/`management` users this will render mostly empty, since those queries are scoped to the logged-in user's own assigned records. This is expected for this iteration — the content is a placeholder, to be replaced with real team-leader-scoped data in a future pass.

## Theming

Window chrome reuses existing app conventions rather than inventing a new look:
- `bg-white dark:bg-gray-900`, `border border-gray-100 dark:border-gray-800`, `rounded-xl`, `shadow-sm` — same as the dashboard's existing stat cards and panels.
- Title bar: subtle bottom border (`border-b border-gray-100 dark:border-gray-800`), title text `text-gray-900 dark:text-white`, minimize/close buttons following the existing icon-button hover pattern (`hover:bg-gray-100 dark:hover:bg-gray-800`).
- Dock: a fixed strip (bottom of the desktop area) styled consistently with the Sidebar's dark palette.

## Motion (anime.js)

`animejs` is already a project dependency (`^4.4.1`), no new install needed.

- **Open/restore** (via Dock): scale 0.9 → 1 + opacity 0 → 1, ~200ms, eased out.
- **Minimize/close**: reverse of the above before the window actually leaves the DOM.
- **Initial load**: windows that start `open` fade/scale in with a ~40ms stagger between them, rather than all appearing simultaneously.
- **Resize/drag**: no animation — follows the pointer directly, as expected for direct manipulation.
- `prefers-reduced-motion` is respected: all of the above skip straight to the end state.

## Data flow

`app/(app)/dashboard/page.tsx` (Server Component) is the only place that talks to Supabase for this feature. It fetches once, then either renders `DashboardContent` directly (agent) or hands the same data down into `ConsoleDesktop` → `TeamleadersConsole` → `DashboardContent` (admin/management). No additional client-side fetching is introduced by this feature.

## Testing

No automated test suite exists in this project (per `CLAUDE.md`). Verification is manual:
- Log in as `agent` — confirm zero visual/behavioral change from today.
- Log in as `admin` — confirm exactly 4 windows (2 Teamleaders + 2 Agents), no Management window/Dock icon reachable.
- Log in as `management` (`tylin.moodley@carecms.local`) — confirm all 5 windows.
- Per role: drag, resize, minimize, close, and reopen (via Dock) each window; confirm focus (z-index) changes on click.
- Toggle light/dark theme and confirm the desktop, windows, and Dock all read correctly in both.

## Out of scope (this iteration)

- Persisting window position/size/open-state across page reloads or sessions.
- Real data for "Agents" and "Management" consoles (currently empty placeholders).
- Real per-team-leader-scoped data for "Teamleaders" consoles (currently reuses the logged-in user's own agent-scoped dashboard query).
- Any change to `/admin/*` routes, RLS policies, or the `admin` role's permissions — this feature only changes what `/dashboard` renders.
- A second `management` account (mentioned as "I'll add another later" — no action needed now).
