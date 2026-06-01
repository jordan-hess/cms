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
npm run setup:users  # Bootstrap first admin + agent in Supabase (run once after schema setup)
```

No test suite is configured.

## First-time Supabase setup

1. Run `supabase/schema.sql` in the Supabase SQL Editor.
2. Run `supabase/fix-auth-trigger.sql` in the SQL Editor (repairs the auth trigger so user creation also creates a profile row — required before any users can be created).
3. Run `supabase/roster-schema.sql` in the SQL Editor (creates teams, shift_templates, team_rotations, team_members, attendance_records, roster_overrides tables and seeds the four default teams: Green, Blue, Red, Yellow).
4. Copy `.env.local.example` → `.env.local` and fill in the three env vars.
5. Run `npm run setup:users` to create `admin@carecms.local / Admin123!` and `agent@carecms.local / Agent123!`.

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
  auth/callback/route.ts  # OAuth code exchange
  api/admin/create-user/  # Service-role user creation (admin only)
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

The admin client (service role key, bypasses RLS) is only constructed inline in `app/api/admin/create-user/route.ts` — do not use it elsewhere.

### Data fetching pattern

All pages inside `(app)/` are **async Server Components**. They fetch data at render time:

```tsx
export default async function SomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const [{ data: a }, { data: b }] = await Promise.all([...]) // parallel queries
}
```

Pages pass initial data as props to `'use client'` manager components (`CustomerManager`, `CallbackManager`, etc.). Those components use the browser client for mutations and call `router.refresh()` to revalidate the server component.

### Authorization layers

Role checks happen at three levels — all three must stay consistent:
1. **`proxy.ts`** — blocks `/admin/*` routes entirely for agents.
2. **Page queries** — admins query all rows; agents filter with `.eq('agent_id', user.id)`.
3. **RLS policies** — database-level enforcement (`supabase/schema.sql`).

### Database schema

Core tables: `profiles`, `customers`, `callbacks`, `followups`, `notifications` — defined in `supabase/schema.sql`.

Roster tables: `teams`, `team_members`, `shift_templates`, `team_rotations`, `attendance_records`, `roster_overrides` — defined in `supabase/roster-schema.sql`; TypeScript types in `types/index.ts`.

Foreign key joins use Supabase's inline select syntax:
```ts
supabase.from('followups').select('*, customers(name), profiles!followups_created_by_fkey(full_name)')
```
