# Team Management — Add Team Member — Design

## Context

The Team Leaders Management board (`/team-leaders`, `management`-role only) can move existing people between teams, promote someone to team leader, edit a person's profile, and remove them from a team — but it has no way to create a brand-new person. That capability exists today only on the admin-only "Manage Agents" page (`app/(app)/admin/agents/page.tsx` → `AgentManager.tsx`), via its "Add Team Member" button and modal, which POSTs to `/api/admin/create-user` to create a new `profiles` row (with a hashed password) for a person who doesn't exist yet.

This adds that same capability to the Team Leaders Management board, and renames the page from "Team Leaders Management" to "Team Management" (title/label only — the `/team-leaders` URL is unchanged).

## Scope (confirmed with you)

- Only the "Add Team Member" button + its create-account modal — not the admin page's other per-row buttons (Assign Shift, etc.), which have no equivalent need here since the board already has its own drag-and-drop/Edit-based ways to assign teams, leaders, and shifts.
- The role dropdown in the modal stays **Agent or Admin**, identical to the admin page — management can create either, matching the parity you asked for.
- Button placement: next to the existing "Add Team" button.
- Rename is title/label only. The route stays `/team-leaders`; `proxy.ts`'s gate, bookmarks, and any internal links are unaffected.

## Shared modal, not a duplicate

The admin page's create-account form (Full Name, Email, Password, Role, Department → `POST /api/admin/create-user`) is currently inlined inside `AgentManager.tsx`. Rather than copy it into a second file, it becomes a standalone `AddTeamMemberModal` component — matching this codebase's existing one-modal-per-file convention (`AddTeamModal.tsx`, `AddTeamLeaderModal.tsx`, `AddToTeamModal.tsx` already live this way in `components/team-leaders/`). Both `AgentManager.tsx` and the new button on `TeamLeadersBoard.tsx` render the same component; the only difference between the two call sites is who can see the button that opens it (admin-page users always could; management-page users get it via this change).

The extracted component owns: its own form state, the `fetch('/api/admin/create-user', ...)` call, loading/error/success display, and the Role/Department fields exactly as they exist today. It takes `open`/`onClose`/`onSuccess` props, matching every other modal in `components/team-leaders/`.

## The one backend change: widen the route's role gate

`app/api/admin/create-user/route.ts` bypasses RLS entirely — it authenticates the caller, then uses a service-role Supabase client for everything else. The *only* authorization check is this explicit line:

```ts
if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
```

This becomes:

```ts
if (profile?.role !== 'admin' && profile?.role !== 'management') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
```

No RLS policy or SQL migration is needed — this route never goes through the caller's own RLS-scoped session client, so there's nothing at the database layer to widen. This mirrors the pattern used for every other management capability this session (widen the single explicit gate), just at the API-route layer instead of a SQL policy.

## After creation

Nothing new needed: `app/(app)/team-leaders/page.tsx` already fetches all `profiles` on every load, and `TeamLeadersBoard`'s `unassigned` list is already derived as "active profiles with no `team_members` row." Once `onSuccess` calls `router.refresh()` (matching the modal's existing behavior), a newly-created person appears in the unassigned pool automatically, ready to be dragged onto a team.

## Files touched

- `components/team-leaders/AddTeamMemberModal.tsx` (new) — extracted shared modal.
- `components/admin/AgentManager.tsx` — remove the inlined modal markup/state/handler, render `AddTeamMemberModal` instead.
- `components/team-leaders/TeamLeadersBoard.tsx` — add the "Add Team Member" button next to "Add Team", plus the modal's open/close state, rendering `AddTeamMemberModal`.
- `app/api/admin/create-user/route.ts` — widen the role check.
- `app/(app)/team-leaders/page.tsx` — `<Header title="Team Management" />`.
- `components/layout/Sidebar.tsx` — the `management` branch's nav label changes from `'Team Leaders Management'` to `'Team Management'` (`href`/`icon` unchanged).

## Verification approach

- As `management`: confirm "Add Team Member" appears next to "Add Team," opens the same form as the admin page, successfully creates a new agent and a new admin account, and both appear in the unassigned pool after refresh, draggable onto a team.
- As `agent`: confirm `/api/admin/create-user` still rejects them (403) — the widened check must not loosen access beyond `admin`/`management`.
- As `admin`: confirm the admin "Manage Agents" page's "Add Team Member" button still works identically post-refactor (same fields, same success/error behavior) — this is a refactor of existing functionality and must not regress it.
- Confirm the Sidebar label and page header both read "Team Management" for `management` users, and the URL is still `/team-leaders`.
