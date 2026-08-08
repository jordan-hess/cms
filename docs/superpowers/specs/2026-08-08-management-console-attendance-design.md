# Management Console — Attendance Summary — Design

## Context

The "console desktop" feature (a windowed dashboard shown to `admin`/`management` roles after login) has five windows today: two "Teamleaders" windows and two "Agents" windows (both just showing the generic agent dashboard content), plus one "Management" window that's a pure placeholder (`EmptyConsoleContent label="Management"`). This fills in the Management window with a live, today-only staff attendance summary: how many agents are Present/Late/Absent/Sick/On Leave/Off, how many team leaders are on shift, and a total staff count.

## Data model — reusing what already exists, not inventing new state

Attendance already has a real, working data model, built for the Roster page:
- `attendance_records` (`profile_id`, `date`, `status` — one of `on_shift`/`late`/`absent`/`sick`/`leave`/`off`, `UNIQUE(profile_id, date)`), manually marked by admins via the Roster page's day view. Most days, most agents have **no row at all** — absence of a row doesn't mean "unknown," it means "trust the rotation schedule."
- `lib/roster/resolveShift.ts`'s `resolveShift()`/`buildSlotMap()` — pure functions that already correctly combine an agent's team rotation for the week, any roster override, and any explicit attendance record into one `effectiveStatus` for a given day. This is the same logic the Roster calendar itself uses — reusing it here means this console's numbers can never disagree with what the Roster page shows for today.
- Team leaders have no equivalent — no rotation, no existing shift concept at all. Per your decision: a leader counts as on shift by default, and only counts as something else if there's an explicit `attendance_records` row for them today. There's currently no UI anywhere to create that row for a leader (only agents get a "mark attendance" cell on the Roster page) — so today, practically every leader will show as on shift. That's a known, disclosed consequence of the current system, not a bug in this console; building a way to mark leader attendance is a separate, future piece of work if wanted.

## Access — two RLS policies need widening

`management`-role users need to be able to read this data; today they can't:
- `attendance_select`: currently "own row or admin" → widen to also allow `management`.
- `roster_overrides_select`: same shape, same fix.

No change needed for `team_members_select`, `team_rotations_select`, `teams_select`, or `shift_templates_select` — all already `USING (true)` (open to every authenticated user). This is read-only access — no insert/update/delete widening, since this console only displays data, it doesn't mark attendance.

## Category mapping

Per your decisions:
- 6 categories, not 5: **Present** (`on_shift`), **Late** (`late`), **Absent** (`absent`), **Sick** (`sick`), **On Leave** (`leave`), **Off** (`off`).
- An agent with no team membership or no rotation this week resolves to `no_rotation` (not one of the 6 real statuses) — folded into **Off** for this summary, rather than adding a 7th bucket. Flagged, not silently decided.
- **Total Staff** = active agents + active team leaders (today: 34 + 4 = 38). Other admins and `management`-role accounts aren't part of the roster/shift system at all and aren't counted.

## Data fetching

Extend `app/(app)/dashboard/page.tsx` (already gated to `admin`/`management` before rendering `ConsoleDesktop`) with one more parallel fetch block, scoped to today's ISO week/date, matching the same flat-fetch convention as every other page in this codebase (no new API route, no RPC):

```ts
supabase.from('team_members').select('*'),
supabase.from('team_rotations').select('*, shift_templates(*)').eq('week_start_date', currentWeekStart),
supabase.from('attendance_records').select('*').eq('date', todayStr),
supabase.from('roster_overrides').select('*, shift_templates(*)').eq('date', todayStr),
supabase.from('team_leaders').select('*'),
supabase.from('profiles').select('id, full_name, role, is_active').eq('is_active', true),
```

This bundle is passed down through `ConsoleDesktop` into a rewritten `ManagementConsole`, which:
1. Filters `profiles` to active `role === 'agent'` for the agent breakdown, and cross-references `team_leaders` for the leader list.
2. Calls `buildSlotMap` (imported directly from `lib/roster/resolveShift.ts`, no duplicated logic) for just today's date, over the agent list.
3. Groups the resulting `effectiveStatus` values into the 6 display categories (folding `no_rotation` into `off`), and separately computes each leader's status via the simple "explicit record or default on_shift" rule.
4. Everything from here — the grouping, counting, and rendering — happens client-side in `ManagementConsole`, the same "server fetches flat data, client component derives view-models" split already used everywhere else in this codebase (Coaching, Team Leaders Management).

## Component design

- `app/(app)/dashboard/page.tsx` — add the fetch block above (only when `role !== 'agent'`, since agents never see `ConsoleDesktop` at all — no point fetching roster-wide data for them).
- `components/console/ManagementConsole.tsx` — rewritten from the current pure stub to accept the new data as props and render the summary.
- `components/console/AttendanceCategoryRow.tsx` (new) — one row per category: label, color-coded count badge (reusing `statusColorClasses`/`statusLabels` from `lib/roster/teamColors.ts` — same colors the Roster calendar already uses for these exact statuses, so "Late" means the same yellow everywhere in the app), and a collapse/expand toggle revealing the actual agent names — same interaction pattern as `LeaderCard`'s agent list in the Coaching page.
- A similar row/section for "Team Leaders on shift" at the bottom, showing the count and an expandable list of leader names.

## Verification approach

- Confirm the widened `attendance_select`/`roster_overrides_select` policies actually let a `management` session read data it couldn't before, and that other roles' access is unaffected.
- Confirm the Management console's per-category counts match what the Roster page's day view shows for the same day, for the same agents (cross-checking against the existing, already-correct source of truth rather than trusting a second, independent implementation).
- Confirm the "no_rotation" folding: find or create an agent with no team membership, confirm they land in "Off," not silently excluded from the total.
- Confirm Total Staff equals active-agents + active-team-leaders exactly.
- Confirm the console renders sensibly at its actual window size (small — this is one of five windows on a desktop, not a full page) and that expanding a category doesn't break the window's layout.
