# Management Dashboard: Per-Team-Leader Consoles

## Context

Today, the post-login Dashboard (`app/(app)/dashboard/page.tsx` → `ConsoleDesktop`) renders the exact same self-scoped "my customers / my pending callbacks / my open follow-ups / my unread alerts" tiles for every role that gets the windowed console UI (`admin` and `management`), via two duplicate "Teamleaders" windows and two duplicate "Agents" windows (`components/console/windowConfig.ts:5-8`) — a pre-existing oddity, not something this plan introduces. For `management`, this is nearly useless: management doesn't personally own customers/callbacks/follow-ups, so these tiles are always near-zero, and the windows convey no real information about the org they're supposed to be overseeing.

The actual need: management should see one console per team leader, showing that team leader's own team's **agents'** aggregated activity — not the team leader's own activity, and not management's own. `agent`/`admin` dashboards must stay pixel-for-pixel unchanged; only `management`'s console layout and data change.

This was scoped through a clarifying-questions pass (in the harness's Plan Mode); the below reflects the user's explicit choices, not assumptions:
- Consoles are **fully automatic**, one per existing `team_leaders` row — no manual "add a console" UI, no new preferences table. When a new team+leader is created elsewhere in the app (the already-existing Team Management feature), its console just appears next dashboard load.
- **"Unread alerts" aggregates the team's agents' notifications** (`recipient_id` in that team's agent ids, `read = false`) — not the team leader's own notifications. This makes all 4 stats consistently "about the team's agents," matching the other 3.
- Management's existing "Agents" windows are removed entirely (the user said "remove the agents console for management").

I verified two load-bearing facts directly against the actual files rather than assuming:
- `components/console/ConsoleDesktop.tsx`'s `renderConsole` (lines 116-125) dispatches purely on a window's `kind` field (`'teamleader' | 'agents' | 'management'`), not on `role` — so admin and management currently render *the identical* `TeamleadersConsole`/`AgentsConsole` components. This means the safe way to change management's behavior without any risk to admin's is to introduce a **new, distinct `ConsoleKind`** used only by management's window config, rather than modifying the existing `'teamleader'`/`'agents'` kinds that admin still uses unchanged.
- `callbacks` RLS (`supabase/schema.sql:148-151`) is **not** open to `management` (unlike `customers`, which is open to everyone, and `followups`, already widened for management by an earlier feature this session). Today, this silently makes management's "Pending Callbacks" tile always read 0. This plan must add a new migration widening it — mirroring the exact pattern already used for followups (`supabase/migrations/management-followups-access.sql`) — or the new per-team-leader "Pending Callbacks" stat will be silently wrong for the same reason.

## Key decisions

- **Consoles are derived, not stored.** No new "which consoles exist" table — the list of consoles is simply every row in `team_leaders`, joined out to its team and agents at page-load time. This is the simplest correct model given the "fully automatic" requirement, and avoids inventing a widget-preferences concept that has zero precedent anywhere else in this codebase (confirmed by a repo-wide grep for `widget|dashboard_config|dashboard_preferences`).
- **A new `ConsoleKind` (`'teamleader-overview'`), not a role-check inside the existing `'teamleader'` case.** `ConsoleDesktop.tsx` dispatches on `kind`, not `role` — reusing the existing `'teamleader'` kind and branching inside `TeamleadersConsole.tsx` would require threading a `role` prop through a component admin also uses, creating exactly the kind of shared-code risk the user's "don't change admin's dashboard" constraint is meant to avoid. A new kind, new window-config entry, and new component keep admin's code path completely untouched — zero lines of admin-serving code are modified.
- **The two duplicate "Teamleaders" windows collapse into one.** They were never meaningfully different (identical `kind`, identical props) — now that the window actually needs to show real per-team-leader content, having two of them would just show the same overview grid twice. One window, sized to comfortably hold a multi-card grid.
- **The "Agents" windows are removed for management, untouched for admin.** `AgentsConsole.tsx` is a static placeholder (`<EmptyConsoleContent label="Agents" />`) with no real data even today — removing it from management's window set loses nothing.
- **The unrelated "Management" (roster/attendance) window is completely out of scope.** It's driven by a separate `managementData` fetch that already does something different (shift/attendance tracking, not customer/callback/followup counts) and is not touched by this plan at all.
- **No links/navigation on the new stat tiles.** The existing `DashboardContent` tiles link to `/customers`, `/callbacks`, etc. because those pages show the *viewer's own* data. A per-team-leader tile showing an aggregate across multiple agents has no corresponding "team-filtered" page to link to today, and building one is out of scope — the new tiles are informational only.
- **Bulk-fetch-then-group, not N+1 per team.** Four queries total (`customers`, `callbacks`, `followups`, `notifications`), each scoped with `.in(<attribution column>, allAgentIds)` across every team at once, then grouped client-side by team — matching the established pattern already used in `CoachingManager.tsx`/`RosterManager.tsx` for the exact same "which agents does this team leader manage" shape of problem.

## Data model — `supabase/migrations/management-callbacks-access.sql`

```sql
-- ============================================================
-- Widen the callbacks SELECT policy so 'management' can read
-- every agent's callbacks — needed for the new per-team-leader
-- dashboard console's "Pending Callbacks" stat. Mirrors the
-- exact pattern already used for followups
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

Confirmed verbatim against the live policy text at `supabase/schema.sql:148-151` — the exact name is `"Agents see their own callbacks"`, and its existing bypass already covers `role = 'admin'`; this migration only adds `'management'` to that same `IN (...)` list, following the identical drop-and-recreate convention as every other `management-*-access.sql` migration this session. Only SELECT is widened — the INSERT (`"Users can insert callbacks"`) and UPDATE (`"Agents can update their callbacks"`) policies are untouched, since this feature only needs to read aggregate counts, not write.

## Types — `types/index.ts` additions

```ts
export interface TeamLeaderConsoleData {
  teamId: string
  teamName: string
  teamColor: string
  leaderName: string
  totalCustomers: number
  pendingCallbacks: number
  openFollowups: number
  unreadAlerts: number
}
```

## Query layer — `app/(app)/dashboard/page.tsx`

Additive only — the existing base `dashboardData` fetch (self-scoped customers/callbacks/followups/notifications, used by every role including `agent`) is left completely unchanged. A new block runs only when `profile.role === 'management'`:

```ts
let teamLeaderConsoles: TeamLeaderConsoleData[] = []

if (profile?.role === 'management') {
  const [{ data: teamLeaderRows }, { data: teamMemberRows }] = await Promise.all([
    supabase
      .from('team_leaders')
      .select('team_id, teams(id, name, color), profiles!team_leaders_profile_id_fkey(full_name)'),
    supabase.from('team_members').select('team_id, profile_id'),
  ])

  const membersByTeam = new Map<string, string[]>()
  for (const tm of teamMemberRows ?? []) {
    const list = membersByTeam.get(tm.team_id) ?? []
    list.push(tm.profile_id)
    membersByTeam.set(tm.team_id, list)
  }

  const allAgentIds = [...new Set((teamMemberRows ?? []).map(tm => tm.profile_id))]

  const [
    { data: allCustomers },
    { data: allCallbacks },
    { data: allFollowups },
    { data: allNotifications },
  ] = allAgentIds.length
    ? await Promise.all([
        supabase.from('customers').select('id, created_by').in('created_by', allAgentIds),
        supabase.from('callbacks').select('id, agent_id').eq('status', 'pending').in('agent_id', allAgentIds),
        supabase.from('followups').select('id, agent_id').in('status', ['open', 'in_progress']).in('agent_id', allAgentIds),
        supabase.from('notifications').select('id, recipient_id').eq('read', false).in('recipient_id', allAgentIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]

  teamLeaderConsoles = (teamLeaderRows ?? []).map(row => {
    const agentIds = membersByTeam.get(row.team_id) ?? []
    const inTeam = (id: string) => agentIds.includes(id)
    return {
      teamId: row.team_id,
      teamName: (row.teams as any)?.name ?? 'Unknown Team',
      teamColor: (row.teams as any)?.color ?? 'blue',
      leaderName: (row.profiles as any)?.full_name ?? 'Unknown',
      totalCustomers: (allCustomers ?? []).filter(c => inTeam(c.created_by)).length,
      pendingCallbacks: (allCallbacks ?? []).filter(c => inTeam(c.agent_id)).length,
      openFollowups: (allFollowups ?? []).filter(f => inTeam(f.agent_id)).length,
      unreadAlerts: (allNotifications ?? []).filter(n => inTeam(n.recipient_id)).length,
    }
  })
}
```

Then pass to `ConsoleDesktop`:

```tsx
<ConsoleDesktop
  role={profile.role}
  dashboardData={{ stats, pendingCallbacks, openFollowups, urgentFollowups }}
  managementData={managementData}
  teamLeaderConsoles={teamLeaderConsoles}
/>
```

The `profiles!team_leaders_profile_id_fkey(...)` embed qualifier above is required because `team_leaders` has two FKs to `profiles` (`profile_id`, `assigned_by`) — the same gotcha already handled twice this session (management-followups, management-requests-approval), reused verbatim here.

## Component design

**`components/console/types.ts`** (modified): `ConsoleKind` gains `'teamleader-overview'` alongside the existing `'teamleader' | 'agents' | 'management'`.

**`components/console/windowConfig.ts`** (modified): `getWindowConfigs('management')` drops the `agents-1`/`agents-2` entries and collapses `teamleader-1`/`teamleader-2` into one `{ id: 'teamleaders-overview', kind: 'teamleader-overview', title: 'Team Leaders', ...larger default size... }`. `getWindowConfigs('admin')` is byte-for-byte unchanged.

**`components/console/TeamLeaderOverviewConsole.tsx`** (new): `{ consoles: TeamLeaderConsoleData[] }` → a responsive grid of cards, one per team leader. Each card: a header row (team color swatch + team name + leader name), then 4 mini stat tiles (Total Customers, Pending Callbacks, Open Follow-ups, Unread Alerts) reusing `DashboardContent`'s tile visual style (`bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border ...`, icon chip + big number + label), minus the `Link` wrapper. Empty state (`consoles.length === 0`) renders a simple centered placeholder message, matching the empty-state pattern used elsewhere in this app (e.g. `FollowupManager`'s "No follow-ups found").

**`components/console/ConsoleDesktop.tsx`** (modified): new optional prop `teamLeaderConsoles?: TeamLeaderConsoleData[]`; one new `case 'teamleader-overview'` in `renderConsole` rendering `<TeamLeaderOverviewConsole consoles={teamLeaderConsoles ?? []} />`. The existing `case 'teamleader'` (→ `TeamleadersConsole`) and `case 'agents'` (→ `AgentsConsole`) cases, still used by `admin`, are untouched.

## Files explicitly NOT modified (and why)

- `components/console/TeamleadersConsole.tsx`, `components/console/AgentsConsole.tsx` — admin still uses these exact components via the unchanged `'teamleader'`/`'agents'` kinds; touching them risks admin's dashboard.
- `components/console/ManagementConsole.tsx` and its `managementData` fetch in `page.tsx` — powers the separate roster/attendance window, unrelated to this feature.
- `components/dashboard/DashboardContent.tsx` — agent's dashboard (and admin's `'teamleader'`-kind windows) keep using it exactly as today; only its *visual tile style* is reused (copied), not the component itself, in the new `TeamLeaderOverviewConsole`.
- `lib/console/windowPersistence.ts` — no code change needed; its id-only keying already tolerates window ids changing (orphaned entries are harmless, never read again).
- `supabase/schema.sql` — no in-place edits; the RLS change lives in the new migration file per established convention.

## Verification approach

No automated test suite exists in this project (per `CLAUDE.md`) — verification is manual:
- Live-run the new migration; confirm no errors.
- Log in as `agent`: confirm the Dashboard is pixel-for-pixel unchanged.
- Log in as `admin`: confirm the Dashboard (including the still-duplicate Teamleaders/Agents windows) is pixel-for-pixel unchanged.
- Log in as `management`: confirm the "Agents" windows are gone, the "Teamleaders" windows are replaced by a single "Team Leaders" window showing one card per existing team leader, and the roster/attendance "Management" window is unaffected.
- Confirm each card's 4 stats match a manual count: create/find a customer/callback/follow-up/unread notification attributed to a specific agent, confirm the number on that agent's team leader's card updates on refresh, and does NOT appear on any other team leader's card.
- Confirm a team leader with zero agents shows a card with all-zero stats (not an error or missing card).
- Confirm the empty-state (no team leaders exist) renders sensibly.
