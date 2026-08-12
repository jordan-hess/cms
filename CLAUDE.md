# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical: This is NOT the Next.js you know

This project uses **Next.js 16.2.6**, which has breaking changes vs. earlier versions — APIs, conventions, and file structure differ from training data. Before writing any Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/`.

**Breaking changes already in effect here:**
- Middleware is `proxy.ts` at the project root (not `middleware.ts`), and the exported function must be named `proxy` (not `middleware`).
- `cookies()` from `next/headers` is now async — always `await cookies()`.
- `params` and `searchParams` in page props are now Promises — `await params` before use.

## Commands

```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npm run lint         # ESLint
npm run setup:users  # Bootstrap first admin + agent + management-dev account in Supabase (run once after schema setup)
```

No test suite is configured.

## First-time Supabase setup

1. Run `supabase/schema.sql` in the Supabase SQL Editor.
2. Run `supabase/fix-auth-trigger.sql` in the SQL Editor (repairs the auth trigger so user creation also creates a profile row — required before any users can be created).
3. Run `supabase/roster-schema.sql` in the SQL Editor (creates teams, shift_templates, team_rotations, team_members, attendance_records, roster_overrides tables and seeds the four default teams: Green, Blue, Red, Yellow).
4. Run `supabase/team-leaders-schema.sql`, then `supabase/coaching-schema.sql` (creates `coaching_agent_checkins`/`coaching_leader_checkins` for the management-only Coaching page).
5. Copy `.env.local.example` → `.env.local` and fill in the env vars.
6. Run `npm run setup:users` to create `admin@carecms.local / Admin123!`, `agent@carecms.local / Agent123!`, and `management-dev@carecms.local / Management123!`.

Note: existing/already-deployed databases that ran `schema.sql` before the `management` role was added need to separately run `supabase/add-management-role.sql` once (fresh installs already get the `management` role from step 1 above).

## Architecture

### Auth & request flow

`proxy.ts` runs on every request (except static assets). It:
1. Creates a Supabase server client and refreshes the session via cookies.
2. Redirects unauthenticated requests to `/login`.
3. Redirects authenticated users away from `/login` to `/dashboard`.
4. Blocks `/admin/*` for non-admin roles by querying `profiles.role`.

### Route structure

```
app/
  layout.tsx              # Root layout
  page.tsx                # Redirects → /dashboard
  login/page.tsx          # Public, client component
  login/legacy/page.tsx   # Legacy Supabase-Auth sign-in (dual-login grace window)
  api/admin/create-user/  # Service-role user creation (admin or management)
  (app)/                  # Protected route group
    layout.tsx            # Auth check + Sidebar
    dashboard/            # Agent home (stats, upcoming items)
    customers/            # CRUD customer records
    callbacks/            # Schedule & manage callbacks
    followups/            # Follow-ups & escalations
    admin/                # Admin-only
      agents/             # Create/deactivate/promote team members
      escalations/        # Send escalations with notifications
```

### Supabase client pattern

Two clients, never mixed up:

| Client | File | When to use |
|--------|------|-------------|
| Server | `lib/supabase/server.ts` | Server Components, Route Handlers, `proxy.ts` — `await createClient()` |
| Browser | `lib/supabase/client.ts` | `'use client'` components — `createClient()` (sync) |

The admin client (service role key, bypasses RLS) is constructed inline, only where a service-role operation is genuinely required: `app/api/admin/create-user/route.ts`, `app/api/admin/review-password-reset/route.ts`, `app/api/auth/security-reset/route.ts`, `app/api/auth/request-password-reset/route.ts`, `app/api/profile/update/route.ts`, and `lib/auth/config.ts`. Do not add new inline admin-client usages elsewhere without good reason.

### Data fetching pattern

All pages inside `(app)/` are **async Server Components**. They fetch data at render time:

```tsx
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'

export default async function SomePage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  const [{ data: a }, { data: b }] = await Promise.all([...]) // parallel queries
}
```

Note: `lib/supabase/server.ts`'s post-migration client is constructed with Supabase's `accessToken` option, which disables the client's entire `.auth` namespace — calling `supabase.auth.getUser()` throws unconditionally for Auth.js-authenticated users. Always resolve the current user via `getCurrentUserId(supabase)` instead (`userId`, not `user.id`).

Pages pass initial data as props to `'use client'` manager components (`CustomerManager`, `CallbackManager`, etc.). Those components use the browser client for mutations and call `router.refresh()` to revalidate the server component.

### Authorization layers

Role checks happen at three levels — all three must stay consistent:
1. **`proxy.ts`** — blocks `/admin/*` routes entirely for agents.
2. **Page queries** — admins query all rows; agents filter with `.eq('agent_id', user.id)`.
3. **RLS policies** — database-level enforcement (`supabase/schema.sql`).

### Database schema

Core tables: `profiles`, `customers`, `callbacks`, `followups`, `notifications` — defined in `supabase/schema.sql`.

Roster tables: `teams`, `team_members`, `shift_templates`, `team_rotations`, `attendance_records`, `roster_overrides` — defined in `supabase/roster-schema.sql`; TypeScript types in `types/index.ts`.

Team-leader tables: `team_leaders` — defined in `supabase/team-leaders-schema.sql` (one leader per team, must be an `admin`-role profile).

Coaching tables (management-only feature): `coaching_agent_checkins` (team-leader↔agent 1-on-1 completion), `coaching_leader_checkins` (management↔team-leader check-in completion) — both keyed per `profile_id` + `period_month`, defined in `supabase/coaching-schema.sql`.

Post-deploy RLS/schema patches applied incrementally after initial setup live in `supabase/migrations/` — run each new file once, live, against the Supabase SQL Editor when it's added.

Foreign key joins use Supabase's inline select syntax:
```ts
supabase.from('followups').select('*, customers(name), profiles!followups_created_by_fkey(full_name)')
```

### Postgres migration scaffolding (schema + data live on SIT; app not cut over)

`lib/db/client.ts`, `lib/db/withUserContext.ts`, and `supabase/postgres/001_initial_schema.sql` target a self-managed SIT Postgres cluster (not Azure's managed Flexible Server product — `SHOW ssl` there reports `off`, and there's no `azure_pg_admin` role, so treat "Azure" in these files' names/comments as historical rather than descriptive of the actual target). The SIT database has the full schema applied and a full data migration from Supabase already completed (2026-08-12) — but **no live route imports these files yet**; the app still reads/writes Supabase for all real traffic. Do not treat the SIT database's populated state as evidence the app has cut over — that cutover (swapping `lib/supabase/*` calls for `withUserContext()`/`withServiceRole()`) is a separate, not-yet-started step.

Two design points that would surprise someone reading the schema file cold:
- **No `authenticated`/`service_role` Postgres roles.** The SIT cluster's connecting role cannot `CREATE ROLE` (company policy). Every RLS policy applies to `PUBLIC` and ORs in `current_setting('app.bypass_rls', true) = 'true'` instead of checking role membership; `FORCE ROW LEVEL SECURITY` is set on every table because the connecting role also owns every table (owners are exempt from their own RLS by default — without FORCE, RLS would silently do nothing).
- **A table with zero policies for some operation makes that operation impossible for everyone, including the bypass-flag path** (there's no policy to embed the check into). This is deliberate for `request_approval_history`'s UPDATE/DELETE (append-only audit trail) and is also why `customers`/`callbacks`/`profiles` have no DELETE policy — confirmed to match live Supabase's own RLS (which has no DELETE policy for these either) and to be a non-regression (no server-side code path deletes these rows; the one client-side `customers` delete button in `CustomerManager.tsx` is already dead code today for the same reason).
