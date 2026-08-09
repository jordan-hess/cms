# Admin "Manage Agents" Page → Shared Team Board — Design

## Context

The admin-only "Manage Agents" page (`app/(app)/admin/agents/page.tsx` + `components/admin/AgentManager.tsx`) is a flat list of every agent/admin profile with per-row buttons: Assign Team, Assign Shift, Set/Edit Leader (admins only), Make agent/admin, Deactivate/Activate. It looks nothing like the `management`-role "Team Management" board (`/team-leaders`, `TeamLeadersBoard.tsx`), which is a kanban-style board of team columns with drag-and-drop, an "Unassigned" panel, and per-card Edit/Remove actions.

This redesign makes admin's page reuse the exact same board component, rather than rebuilding a look-alike, so both pages stay visually and behaviorally identical except for the handful of admin-only actions the board doesn't otherwise need.

## Architecture

`TeamLeadersBoard.tsx` gains two new optional props:
- `isAdminView?: boolean` (default `false`) — `app/(app)/team-leaders/page.tsx`'s existing call site is untouched.
- `shiftTemplates?: ShiftTemplate[]` — only needed/passed when `isAdminView` is true, for the new Assign Shift action.

`app/(app)/admin/agents/page.tsx` fetches the same data shape the board already consumes (`teams`, `team_members`, `team_leaders`, all `profiles` — including inactive, since admin needs to find and reactivate them) plus `shift_templates`, and renders:
```tsx
<TeamLeadersBoard
  isAdminView
  shiftTemplates={shiftTemplates}
  teams={teams}
  teamMembers={teamMembers}
  teamLeaders={teamLeaders}
  allProfiles={allProfiles}
  currentUserId={userId}
/>
```
directly — no manager-component wrapper, matching exactly how `app/(app)/team-leaders/page.tsx` already calls the board today. `components/admin/AgentManager.tsx` is deleted; it has no remaining purpose once the page renders the board directly.

## Behavior differences gated by `isAdminView`

- **Unassigned panel**: today it's `allProfiles.filter(p => p.is_active && !hasTeam)`. Under `isAdminView`, the `is_active` condition drops, so deactivated+unassigned people are visible (rendered greyed out, matching how inactive *team* members already render via `PersonCard`'s existing `!person.is_active` opacity styling). Management's view is unchanged — still active-only.
- **PersonCard gains two new optional props**: `onAssignShift?: (personId: string, fullName: string) => void` and `onToggleActive?: (personId: string, isActive: boolean) => void`, each rendered as an additional icon button only when the prop is provided — the same "optional prop → conditionally rendered button" pattern `onRemove?` already established. `TeamColumn` and `UnassignedPanel` both gain matching optional passthrough props with the same names, wired straight through to their `PersonCard` calls.
- **Own-card safety guard**: on the card whose `person.id === currentUserId`, `onAssignShift`/`onToggleActive` are not passed at all when rendering your own card (regardless of `isAdminView`), so those two buttons never appear on your own card. Dragging your own card between teams/leader slots, and using Edit for your own name/department, remain fully available — the board already supports both naturally and neither carries the "lock yourself out" risk Deactivate does.
- **`EditPersonModal`'s Role field**: gains a new check — when `person.id === currentUserId`, the Role `<select>` is disabled and a short note explains why ("You can't change your own role"). This is the one genuinely new risk introduced by making your own card reachable at all (today, Edit is never reachable for your own row, so this situation can't currently arise).

## What gets deleted

- `components/admin/AgentManager.tsx` — fully replaced by the board.
- The "Manage Teams" button and `components/admin/ManageTeamsModal.tsx` — confirmed (via a repo-wide search) this modal has no callers besides `AgentManager.tsx`. Its only two capabilities — create a team, view a team/leader/member-count summary — are already fully covered by the board's own "Add Team" button and each `TeamColumn`'s visible name/leader/member-count, plus inline rename (pencil) and delete (trash) icons already on every column.
- The old per-row "Assign Team" and "Set/Edit Leader" buttons — superseded by the board's drag-and-drop and each column's "+" leader-assign icon (`AddTeamLeaderModal`, which already auto-promotes a non-admin to admin on assignment, matching what "Set Leader" did). `AssignTeamModal` and `AssignTeamLeaderModal` themselves are NOT deleted — `components/roster/RosterManager.tsx` still uses both independently.

## What's unaffected

`AssignShiftModal` (reused as-is for the new Assign Shift button), `AddTeamModal`, `AddToTeamModal`, `AddTeamLeaderModal`, `EditTeamNameModal`, `AddTeamMemberModal`, `UnassignedPanel`'s core rendering, and every existing management-facing behavior of the board are unchanged. `AgentManager`'s promote/demote capability is preserved via `EditPersonModal`'s existing Role field (already supports agent/admin/management) — no new UI needed there beyond the self-edit guard above.

## Verification approach

- As `admin`: confirm the "Manage Agents" nav entry now renders the same kanban board layout as management's "Team Management" page — team columns, drag-and-drop, Unassigned panel (now including deactivated people, greyed out).
- Confirm Assign Shift and Deactivate/Activate buttons appear on every card except your own.
- Confirm dragging your own card between teams/leader slots still works, and Edit still works for your own name/department but the Role field is disabled with an explanatory note.
- Confirm deactivating someone via their card's button still works and they remain visible (greyed out) in Unassigned; reactivating them un-greys them.
- Confirm "Manage Teams" is gone from the page and creating/renaming/deleting a team still works via the board's own controls.
- Confirm `management`-role users on `/team-leaders` see no change at all — no Assign Shift/Deactivate buttons, no inactive people in Unassigned.
- Confirm `RosterManager`'s own use of `AssignTeamModal`/`AssignTeamLeaderModal` is unaffected (those files aren't touched, only their usage inside `AgentManager` is dropped).
