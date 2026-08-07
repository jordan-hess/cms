# Phase 1a: Local Password Auth Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Auth with Auth.js v5 (Credentials provider, password-based) as the app's session/login mechanism, while Supabase Postgres and all ~64 RLS policies keep working completely untouched — by minting Supabase-compatible JWTs for outgoing Postgres calls. Microsoft/Azure AD SSO is explicitly deferred to a follow-up "Phase 1b" plan, per the architecture plan's own sequencing ("password auth first, since it's simpler and battle-tested faster").

**Architecture:** Two independent token systems coexist: (1) Auth.js's own encrypted session JWT (cookie, `AUTH_SECRET`) — used by `auth()` in `proxy.ts`/Server Components to know who's logged in; (2) a Supabase-compatible JWT (`SUPABASE_JWT_SECRET`, from `lib/auth/jwt.ts` built in Phase 0) — minted server-side on demand and injected into the Supabase JS client via its documented third-party-auth `accessToken` callback option, so `auth.uid()` keeps resolving correctly inside RLS policies with zero changes to any of the ~35 files that call `.from(...)`. A temporary "legacy login" path (old `@supabase/ssr` flow, unmodified) stays reachable in parallel as the rollback path for the grace window.

**Tech Stack:** Next.js 16 App Router, Auth.js v5 (`next-auth@beta`), `bcryptjs` (password hashing), `jose` (JWT, already installed in Phase 0), `@supabase/supabase-js` (kept, Postgres stays on Supabase this phase).

## Global Constraints

- Supabase Postgres is NOT touched this phase — same schema, same RLS policies, same tables. Only the auth/session layer changes.
- Every one of the ~35 files that call `.from(...)` on a Supabase client MUST continue to work with zero changes. This is achieved via the `accessToken` option on `@supabase/supabase-js`'s `createClient` — confirmed present in the installed version (`node_modules/@supabase/supabase-js/src/lib/types.ts:213`, `accessToken?: () => Promise<string | null>`). Per that option's own doc comment, setting it disables the client's `.auth` namespace — any file that calls `supabase.auth.*` (not just `.from(...)`) needs explicit rewriting; every such call site in this codebase is already enumerated below (Sidebar.tsx, change-password/page.tsx, login/page.tsx, the 3 admin/auth API routes) — there are no others.
- Password hashing: **bcryptjs** (pure JS, no native bindings) — not `argon2`/`@node-rs/argon2` as informally floated earlier, because this environment has already hit native-tooling friction (no local `pg_dump`/`psql`), and the likely deploy target (no Vercel/Docker/CI config found in the repo) favors a dependency with zero build step.
- `AUTH_SECRET` (Auth.js's own session encryption secret) and `SUPABASE_JWT_SECRET` (Phase 0's compatibility JWT signing secret, from Supabase Project Settings → API → JWT Settings) must both be present in `.env.local` before Task 3 can be verified end-to-end. Task 1-2's code can be written without them; note in each task's verification step where this blocks a full manual check.
- No automated test suite exists in this project (per `CLAUDE.md`) — every task's verification step is manual: `npx tsc --noEmit`, `npm run lint`, and where possible a live `npm run dev` check.
- This work happens in an isolated git worktree (per the user's explicit choice) — set up via `superpowers:using-git-worktrees` before Task 1 starts.
- Dual-login grace window: the OLD Supabase-Auth-based login must keep working in parallel throughout this phase, as the rollback path. It is not removed until a separate, later "close the grace window" step (outside this plan) once the new path is proven in production.

---

### Task 1: Password hashing utility + `password_hash` column migration

**Files:**
- Create: `supabase/migrations/phase1-password-hash.sql`
- Create: `lib/auth/password.ts`

**Interfaces:**
- Consumes: nothing (foundational task).
- Produces: `hashPassword(plain: string): Promise<string>` and `verifyPassword(plain: string, hash: string): Promise<boolean>`, both exported from `lib/auth/password.ts`. Tasks 2, 8, 9, 10 all import these exact names.

- [ ] **Step 1: Write the migration SQL (for the user to run in the Supabase SQL Editor — same pattern as `supabase/add-management-role.sql`)**

Create `supabase/migrations/phase1-password-hash.sql`:

```sql
-- Adds password_hash for the new Auth.js Credentials-based login.
-- Nullable: existing users have NULL until they set a new password via
-- /change-password (see the force_password_change migration in Task 11).
-- Run this once in the Supabase SQL Editor.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;
```

- [ ] **Step 2: Install bcryptjs**

Run: `npm install bcryptjs && npm install -D @types/bcryptjs`

- [ ] **Step 3: Write the hashing utility**

Create `lib/auth/password.ts`:

```ts
import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors.
Write a throwaway verification (do not commit a test file — no test suite exists in this project): in a scratch `node -e` or a temporary script, call `hashPassword('Test1234!')` then `verifyPassword('Test1234!', <hash>)` and confirm it returns `true`, and `verifyPassword('wrong', <hash>)` returns `false`. Report the exact commands/output in your task report.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/phase1-password-hash.sql lib/auth/password.ts package.json package-lock.json
git commit -m "feat: add password hashing utility and password_hash migration"
```

---

### Task 2: Install and configure Auth.js v5 (Credentials provider only)

**Files:**
- Create: `lib/auth/config.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `verifyPassword` from `lib/auth/password.ts` (Task 1).
- Produces: `auth`, `handlers`, `signIn`, `signOut` exported from `lib/auth/config.ts` (the standard Auth.js v5 `NextAuth()` return shape). Tasks 3, 5, 6, 7, 10 all import `auth` (and `signOut` for Task 10) from this exact path.

- [ ] **Step 1: Install next-auth v5**

Run: `npm install next-auth@beta`

- [ ] **Step 2: Generate AUTH_SECRET**

Run: `npx auth secret` (writes/prints a secret) — or manually: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Add the result to `.env.local` as `AUTH_SECRET=<value>` (do not commit `.env.local` — it's gitignored). Add a placeholder line to `.env.local.example`.

- [ ] **Step 3: Write the Auth.js config**

Create `lib/auth/config.ts`:

```ts
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { createClient } from '@supabase/supabase-js'
import { verifyPassword } from './password'

function createLookupClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email
        const password = credentials?.password
        if (typeof email !== 'string' || typeof password !== 'string') return null

        const supabase = createLookupClient()
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, email, full_name, password_hash, is_active')
          .eq('email', email.toLowerCase().trim())
          .single()

        if (!profile || !profile.password_hash || !profile.is_active) return null

        const valid = await verifyPassword(password, profile.password_hash)
        if (!valid) return null

        return { id: profile.id, email: profile.email, name: profile.full_name }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id
      return token
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub
      return session
    },
  },
})
```

- [ ] **Step 4: Add the Auth.js route handler**

Create `app/api/auth/[...nextauth]/route.ts`:

```ts
export { GET, POST } from '@/lib/auth/config'
```

- [ ] **Step 5: Document the new env vars**

Add to `.env.local.example` (after the existing three Supabase vars):

```
AUTH_SECRET=
SUPABASE_JWT_SECRET=
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors. This task isn't reachable from the UI yet (login page still calls the old Supabase auth) — no browser check for this task alone.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/config.ts "app/api/auth/[...nextauth]/route.ts" .env.local.example package.json package-lock.json
git commit -m "feat: add Auth.js v5 config with Credentials provider"
```

---

### Task 3: Rewrite `lib/supabase/server.ts` to mint Supabase-compatible JWTs from the Auth.js session

**Files:**
- Modify: `lib/supabase/server.ts`

**Interfaces:**
- Consumes: `auth` from `lib/auth/config.ts` (Task 2); `mintSupabaseCompatibleJWT` from `lib/auth/jwt.ts` (built in Phase 0, already exists — do not recreate).
- Produces: `createClient(): Promise<SupabaseClient>` — **signature unchanged** from today. Every one of the ~15 server-side callers (`app/(app)/dashboard/page.tsx`, `app/(app)/admin/**/page.tsx`, etc.) keeps calling `const supabase = await createClient()` exactly as before; none of those files are touched by this task.

- [ ] **Step 1: Rewrite the file**

Replace the full contents of `lib/supabase/server.ts` with:

```ts
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { auth } from '@/lib/auth/config'
import { mintSupabaseCompatibleJWT } from '@/lib/auth/jwt'

export async function createClient(): Promise<SupabaseClient> {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => {
        const session = await auth()
        const userId = session?.user?.id
        if (!userId) return null
        return mintSupabaseCompatibleJWT(userId, { email: session.user.email ?? undefined })
      },
    }
  )
}
```

Note: this drops the `@supabase/ssr` cookie-refresh machinery entirely — Auth.js's `auth()` is now the single source of session truth server-side, and a fresh Supabase-compatible JWT is minted per call (cheap: pure `jose` HS256 signing, no network round trip).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors.
This cannot be exercised end-to-end yet (nothing signs in via Auth.js until Task 6), and requires `SUPABASE_JWT_SECRET` to be set to actually mint a valid token — note in your report whether that env var is present in `.env.local` yet; if not, state clearly that this task is code-complete but unverified against a live session, and that verification is deferred to Task 6's/Task 12's end-to-end check.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/server.ts
git commit -m "feat: rewrite lib/supabase/server.ts to mint Supabase-compatible JWTs from Auth.js session"
```

---

### Task 4: Add `/api/auth/supabase-token` route + rewrite `lib/supabase/client.ts`

**Files:**
- Create: `app/api/auth/supabase-token/route.ts`
- Modify: `lib/supabase/client.ts`

**Interfaces:**
- Consumes: `auth` from `lib/auth/config.ts` (Task 2); `mintSupabaseCompatibleJWT` from `lib/auth/jwt.ts`.
- Produces: `createClient(): SupabaseClient` — **signature unchanged, still synchronous**. All 21 files that call `const supabase = createClient()` from `@/lib/supabase/client` keep working with zero changes (verified list: `app/login/page.tsx`, `components/layout/Sidebar.tsx`, `app/(app)/change-password/page.tsx`, `components/callbacks/CallbackManager.tsx`, `components/layout/Header.tsx`, `components/roster/admin/TeamRequestsModal.tsx`, `components/admin/ManageTeamsModal.tsx`, `components/admin/AgentManager.tsx`, `components/roster/admin/AssignTeamLeaderModal.tsx`, `components/requests/admin/RequestReviewDrawer.tsx`, `components/requests/OvertimeRequestForm.tsx`, `components/requests/LeaveRequestForm.tsx`, `components/roster/admin/AssignRotationModal.tsx`, `components/roster/admin/ShiftTemplateModal.tsx`, `components/roster/admin/AssignShiftModal.tsx`, `components/admin/EscalationManager.tsx`, `components/followups/FollowupManager.tsx`, `components/customers/CustomerManager.tsx`, `components/roster/admin/AssignTeamModal.tsx`, `components/roster/admin/RosterOverrideModal.tsx`, `components/roster/admin/MarkAttendanceModal.tsx`). Do not modify any of these files in this task.

- [ ] **Step 1: Add the token-issuing API route**

Create `app/api/auth/supabase-token/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth/config'
import { mintSupabaseCompatibleJWT } from '@/lib/auth/jwt'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await mintSupabaseCompatibleJWT(userId, { email: session.user.email ?? undefined, expiresInSeconds: 300 })
  return NextResponse.json({ token })
}
```

This route is intentionally minimal — it reuses the same Auth.js session cookie the browser already sends, so no extra auth is needed on top.

- [ ] **Step 2: Rewrite the browser client with a memoized `accessToken` callback**

Replace the full contents of `lib/supabase/client.ts` with:

```ts
import { createBrowserClient } from '@supabase/ssr'

let cachedToken: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 10_000) {
    return cachedToken.value
  }

  const res = await fetch('/api/auth/supabase-token')
  if (!res.ok) {
    cachedToken = null
    return null
  }

  const { token } = await res.json()
  cachedToken = { value: token, expiresAt: Date.now() + 5 * 60 * 1000 }
  return token
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { accessToken: getAccessToken }
  )
}
```

Note: `createBrowserClient` (from `@supabase/ssr`) also accepts the `accessToken` option — it's a thin wrapper over the same `SupabaseClient` constructor. The module-level `cachedToken` is intentional memoization per the `accessToken` option's own doc comment ("may be called concurrently and many times... use memoization"); a 5-minute cache matching the token's own `expiresInSeconds: 300` in Step 1, refreshed 10 seconds before expiry to avoid a race against an in-flight request.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors. Full behavior isn't exercisable yet (no Auth.js session exists until Task 6 lets someone sign in) — defer live verification to Task 6/12.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/supabase-token/route.ts lib/supabase/client.ts
git commit -m "feat: add supabase-token route and rewrite browser client for third-party auth"
```

---

### Task 5: Rewrite `proxy.ts` — Auth.js primary, legacy Supabase session as grace-window fallback

**Files:**
- Modify: `proxy.ts`

**Interfaces:**
- Consumes: `auth` from `lib/auth/config.ts` (Task 2).
- Produces: the `proxy` export (Next 16's required middleware export name — see `CLAUDE.md`'s "Critical: This is NOT the Next.js you know" section) now recognizes two independent, valid sessions. Task 7's legacy login page depends on the exact fallback behavior defined here: it must set a real `@supabase/ssr` cookie-based session (via `supabase.auth.signInWithPassword`) that this fallback path can read.

- [ ] **Step 1: Rewrite the file**

Replace the full contents of `proxy.ts` with:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/lib/auth/config'

async function getLegacySupabaseUser(request: NextRequest, response: NextResponse) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })
  const { pathname } = request.nextUrl

  const session = await auth()
  let userId = session?.user?.id ?? null

  // Grace-window fallback: accept a still-valid legacy Supabase session
  // (see docs/superpowers/plans/2026-08-07-phase1-auth-cutover.md, Task 7).
  // Remove this whole branch once the grace window closes.
  let legacySupabase: Awaited<ReturnType<typeof getLegacySupabaseUser>>['supabase'] | null = null
  if (!userId) {
    const legacy = await getLegacySupabaseUser(request, response)
    if (legacy.user) {
      userId = legacy.user.id
      legacySupabase = legacy.supabase
    }
  }

  if (!userId && pathname !== '/login' && !pathname.startsWith('/api/') && pathname !== '/auth/callback') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (userId && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  if (userId && !pathname.startsWith('/api/') && pathname !== '/change-password') {
    const client = legacySupabase ?? await (await import('@/lib/supabase/server')).createClient()

    const { data: profile } = await client
      .from('profiles')
      .select('role, force_password_change')
      .eq('id', userId)
      .single()

    if (profile?.force_password_change) {
      return NextResponse.redirect(new URL('/change-password', request.url))
    }

    if (pathname.startsWith('/admin') && profile?.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

Note: `legacySupabase` is reused directly when set (it already has a live, authenticated session from the fallback check above); otherwise the Task 3 client is constructed once via a dynamic `import()` — used here (rather than a static top-level import) only to avoid a require-cycle risk between `proxy.ts` and `lib/supabase/server.ts` (which itself imports `lib/auth/config.ts`); if a static `import { createClient } from '@/lib/supabase/server'` at the top of the file compiles and runs cleanly (verify this first), prefer that over the dynamic import — simpler, same result.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors.
Manual check: `npm run dev`, confirm you're redirected to `/login` when logged out, and that visiting `/login` while an old Supabase session cookie is still valid (e.g. if you were logged in before this task) redirects you to `/dashboard` (proving the legacy fallback path works) — report exactly what you observed.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "feat: rewrite proxy.ts with Auth.js session + legacy Supabase session fallback"
```

---

### Task 6: Rewrite the login page's password path to use Auth.js; hide the Microsoft button

**Files:**
- Modify: `app/login/page.tsx`

**Interfaces:**
- Consumes: `signIn` from `next-auth/react` (a client-side helper Auth.js v5 ships — usable standalone without a `SessionProvider` when only calling it imperatively, not using the `useSession()` hook).
- Produces: no new exports; this is a leaf UI change. Task 7 adds a link on this page to the legacy login route.

- [ ] **Step 1: Replace `handleLogin` and hide the Microsoft button**

In `app/login/page.tsx`, replace the imports, `handleLogin`, and `handleMicrosoftLogin` with:

```tsx
import { signIn } from 'next-auth/react'
```

(keep the existing `import { createClient } from '@/lib/supabase/client'` — it's still used elsewhere on this page for the forgot-password flow, which is untouched by this task)

```tsx
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginError('')
    setLoginLoading(true)
    const result = await signIn('credentials', { email, password, redirect: false })
    if (result?.error) {
      setLoginError('Invalid email or password.')
      setLoginLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }
```

Delete `handleMicrosoftLogin` entirely (Phase 1b will reintroduce Microsoft sign-in via Auth.js's own Microsoft Entra ID provider — a different mechanism than the deleted `supabase.auth.signInWithOAuth` call, so there's nothing worth keeping here as a stub).

Remove the Microsoft sign-in button's JSX (if a button referencing `handleMicrosoftLogin` exists in the current file — read the file first to find it precisely; there was a "Sign in with Microsoft" button added earlier this session inside the `view === 'login'` block, below the main form). Leave a one-line comment where it was: `{/* Microsoft sign-in returns in Phase 1b via Auth.js's Microsoft Entra ID provider */}`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors.
Manual check: `npm run dev`, attempt to log in with `agent@carecms.local` / `Agent123!`. **This will fail** at this point in the plan — `profiles.password_hash` is still NULL for every existing user (Task 1 only added the column; Task 11 is what actually sets real hashes via the migration flow). Confirm the failure mode is a clean "Invalid email or password" error, not a crash or unhandled exception — report exactly what you observed. Real end-to-end login success is verified in Task 12, after Task 7's legacy path and Task 11's migration exist.

- [ ] **Step 3: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat: switch login page's password path to Auth.js signIn"
```

---

### Task 7: Legacy login page + data-access fallback (dual-login grace window)

**Amended after Task 5's review.** The review caught a load-bearing gap: `proxy.ts`'s legacy-session fallback (Task 5) only affects the *gate* — it decides who gets past `proxy.ts` — but `lib/supabase/server.ts` and `lib/supabase/client.ts` (Tasks 3-4) mint their Supabase-compatible tokens *only* from an Auth.js session. A legacy-session user would pass the gate and then get an anon-role client for every actual data query (every RLS policy in this project is `TO authenticated`, never `TO anon`), landing on a fully broken, empty app — defeating the entire purpose of the grace window. This task now also extends both client factories with the same legacy-session fallback `proxy.ts` already has, so a legacy-session user gets a real, working, authenticated data client too, not just past the gate.

**Files:**
- Create: `lib/supabase/legacyAuthClient.ts`
- Create: `app/login/legacy/page.tsx`
- Modify: `app/login/page.tsx` (add a link to the legacy page)
- Modify: `lib/supabase/server.ts` (add legacy-session fallback alongside the Task 3 Auth.js path)
- Modify: `app/api/auth/supabase-token/route.ts` (add legacy-session fallback alongside the Task 4 Auth.js path)

**Interfaces:**
- Consumes: nothing new for the login page itself — `createBrowserClient` from `@supabase/ssr` directly (bypassing the Task 4 `accessToken`-wrapped client entirely, since legacy login needs Supabase's own native `.auth` namespace, which the wrapped client disables). The server/route fallback additions consume `createServerClient` from `@supabase/ssr` and `cookies` from `next/headers`, mirroring `proxy.ts`'s own fallback pattern from Task 5.
- Produces: `createLegacyAuthClient(): SupabaseClient` from `lib/supabase/legacyAuthClient.ts`. `lib/supabase/server.ts`'s `createClient()` keeps its exact signature (`Promise<SupabaseClient>`, no arguments) — still zero changes needed in any of its ~15 callers. `app/api/auth/supabase-token/route.ts`'s response shape (`{ token }` or `{ error }`, same status codes) is unchanged — `lib/supabase/client.ts` (Task 4) needs no changes at all, since from its perspective it's still just fetching a token string from the same route.

- [ ] **Step 1: Extend `lib/supabase/server.ts` with a legacy-session fallback**

Replace the full contents of `lib/supabase/server.ts` with:

```ts
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth/config'
import { mintSupabaseCompatibleJWT } from '@/lib/auth/jwt'

export async function createClient(): Promise<SupabaseClient> {
  const session = await auth()

  if (!session?.user?.id) {
    // Grace-window fallback: no Auth.js session — check for a still-valid
    // legacy Supabase session (mirrors proxy.ts's own fallback from Task 5).
    // If found, return a client using it directly (it already carries a
    // real, valid Supabase-issued token) instead of falling through to an
    // anon-role client that RLS would silently deny everything to.
    const cookieStore = await cookies()
    const legacyClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
            } catch {}
          },
        },
      }
    )
    const { data: { user } } = await legacyClient.auth.getUser()
    if (user) return legacyClient
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => {
        const s = await auth()
        const userId = s?.user?.id
        if (!userId) return null
        return mintSupabaseCompatibleJWT(userId, { email: s.user.email ?? undefined })
      },
    }
  )
}
```

Note: `auth()` is called once upfront to decide which branch to take, and again inside the `accessToken` callback (matching Task 3's original design, where the callback re-derives the session fresh each time it's invoked — Supabase may call `accessToken` multiple times per request/session lifetime, so it must stay self-sufficient rather than close over a possibly-stale outer variable). This is a minor, acceptable redundancy, not a bug.

- [ ] **Step 2: Extend `app/api/auth/supabase-token/route.ts` with the matching fallback**

Replace the full contents of `app/api/auth/supabase-token/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { auth } from '@/lib/auth/config'
import { mintSupabaseCompatibleJWT } from '@/lib/auth/jwt'
import { TOKEN_LIFETIME_SECONDS } from '@/lib/auth/supabase-token-constants'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id

  if (userId) {
    const token = await mintSupabaseCompatibleJWT(userId, {
      email: session.user.email ?? undefined,
      expiresInSeconds: TOKEN_LIFETIME_SECONDS,
    })
    return NextResponse.json({ token })
  }

  // Grace-window fallback: a still-valid legacy Supabase session's own
  // access token already works as-is — no minting needed.
  const cookieStore = await cookies()
  const legacyClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )
  const { data: { session: legacySession } } = await legacyClient.auth.getSession()
  if (legacySession?.access_token) {
    return NextResponse.json({ token: legacySession.access_token })
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

(`lib/auth/supabase-token-constants.ts` already exists from Task 4's fix round — import `TOKEN_LIFETIME_SECONDS` from it, do not redefine `300` inline.)

- [ ] **Step 3: Add the legacy client factory**

Create `lib/supabase/legacyAuthClient.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'

// Grace-window-only: the original pre-Phase-1 browser client, with Supabase's
// own .auth namespace intact (no accessToken override). Used exclusively by
// app/login/legacy/page.tsx as a rollback path while migrating existing
// users off Supabase Auth. Delete this file once the grace window closes.
export function createLegacyAuthClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 4: Add the legacy login page**

Create `app/login/legacy/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLegacyAuthClient } from '@/lib/supabase/legacyAuthClient'
import { Loader2 } from 'lucide-react'

const inputCls = 'w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm'
const errorCls = 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3'

export default function LegacyLoginPage() {
  const router = useRouter()
  const supabase = createLegacyAuthClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-950 dark:to-gray-900 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-8">
          <div className="flex flex-col items-center mb-8">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Legacy Sign In</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 text-center">
              Temporary fallback during the auth migration. Use this only if the normal sign-in page isn&apos;t working.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email address</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="you@company.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
            </div>
            {error && <div className={errorCls}>{error}</div>}
            <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2.5 rounded-lg transition">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add a proxy.ts exemption for the new public route**

`proxy.ts`'s public-path check (Task 5) currently allows `/login`, `/api/*`, `/auth/callback`. Add `/login/legacy` to that list — edit the condition in `proxy.ts` from:

```ts
if (!userId && pathname !== '/login' && !pathname.startsWith('/api/') && pathname !== '/auth/callback') {
```

to:

```ts
if (!userId && pathname !== '/login' && pathname !== '/login/legacy' && !pathname.startsWith('/api/') && pathname !== '/auth/callback') {
```

- [ ] **Step 6: Add a small link from the main login page**

In `app/login/page.tsx`, near the footer text (`"Contact your administrator to get access"`), add:

```tsx
<Link href="/login/legacy" className="block text-center text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 mt-2">
  Trouble signing in? Use the legacy sign-in
</Link>
```

Add `import Link from 'next/link'` if not already imported (it is not, per the current file's imports — check before assuming).

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors.
Manual check: `npm run dev`, go to `/login/legacy`, sign in with `agent@carecms.local` / `Agent123!` (still a valid Supabase Auth user at this point — nothing has touched Supabase Auth users yet). Confirm you land on `/dashboard` successfully, AND confirm data actually loads on the dashboard (stat cards, panels) — this is the real end-to-end proof that BOTH `proxy.ts`'s legacy fallback (Task 5) AND the Step 1-2 data-access fallback added in this task work correctly together. Before this task's Step 1-2 additions, this exact check would have shown an empty/broken dashboard despite a successful-looking login — confirm that is no longer the case.

- [ ] **Step 8: Commit**

```bash
git add lib/supabase/server.ts "app/api/auth/supabase-token/route.ts" lib/supabase/legacyAuthClient.ts "app/login/legacy/page.tsx" app/login/page.tsx proxy.ts
git commit -m "feat: add legacy login page and extend data-access clients with legacy-session fallback"
```

---

### Task 7.5: Add `getCurrentUserId` helper and update all protected pages to stop calling `supabase.auth.getUser()` directly

**Newly discovered during Task 7's review — a severe, previously-missed gap, not a follow-up.** Supabase's `accessToken` client option (the mechanism Task 3 uses to mint compatible JWTs from an Auth.js session) has a documented side effect: once set, the client's ENTIRE `.auth` namespace throws on any access (`node_modules/@supabase/supabase-js`'s `SupabaseClient` constructor wraps `this.auth` in a `Proxy` that throws for every property access when `accessToken` is configured — confirmed by reading the installed package's source directly, not assumed). Every one of the 11 files below is an async Server Component that calls `const { data: { user } } = await supabase.auth.getUser()` on the client returned by `lib/supabase/server.ts`'s `createClient()` — this is `CLAUDE.md`'s own documented "Data fetching pattern," used everywhere. For an Auth.js-authenticated user (the primary, going-forward path, not just the legacy grace-window edge case), this throws unconditionally — every protected page in the app would 500. This must be fixed before Task 12's QA, since Task 12 is the first point the plan would have caught this by actually logging in as a real Auth.js user and hitting these pages.

Why this didn't break Tasks 1-7's own verification: none of those tasks' manual checks logged in as a *migrated* Auth.js user and loaded a data-bearing page — Task 6 confirmed only that login *rejects* correctly (no profile has a real password yet), and Task 7 confirmed the *legacy* path specifically (whose client branch does NOT set `accessToken`, so `.auth.getUser()` works fine there — this is exactly why Task 7's live check "worked" while this gap remained hidden).

**Files:**
- Create: `lib/auth/getCurrentUserId.ts`
- Modify: `app/(app)/layout.tsx`
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `app/(app)/customers/page.tsx`
- Modify: `app/(app)/callbacks/page.tsx`
- Modify: `app/(app)/followups/page.tsx`
- Modify: `app/(app)/roster/page.tsx`
- Modify: `app/(app)/admin/layout.tsx`
- Modify: `app/(app)/admin/page.tsx`
- Modify: `app/(app)/admin/agents/page.tsx`
- Modify: `app/(app)/admin/escalations/page.tsx`
- Modify: `app/(app)/admin/requests/page.tsx`

(`app/(app)/change-password/page.tsx` also calls `supabase.auth.getUser()` today, but Task 10 already removes that entirely as part of its own rewrite — do not touch that file in this task, it would just create a merge conflict with Task 10's work.)

**Interfaces:**
- Consumes: `auth` from `lib/auth/config.ts` (Task 2).
- Produces: `getCurrentUserId(supabase: SupabaseClient): Promise<string | null>` from `lib/auth/getCurrentUserId.ts`. This is the new standard way every Server Component gets the current user's id — any future page added to this codebase should use it instead of `supabase.auth.getUser()`.

- [ ] **Step 1: Add the helper**

Create `lib/auth/getCurrentUserId.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { auth } from './config'

/**
 * Resolves the current user's id from whichever session is active.
 *
 * `lib/supabase/server.ts`'s createClient() returns one of two client
 * shapes depending on which session authenticated the request: the
 * Auth.js-JWT-minting client (accessToken option set — Supabase disables
 * its ENTIRE .auth namespace in this mode, throwing on any access), or the
 * raw legacy-session client (accessToken NOT set, .auth fully functional)
 * for a grace-window legacy user. Calling `supabase.auth.getUser()`
 * directly only works for the second case. This function checks the
 * Auth.js session first (the common case going forward) and only touches
 * `supabase.auth.getUser()` when there is no Auth.js session — at which
 * point the client is guaranteed to be the legacy one, so it's safe.
 */
export async function getCurrentUserId(supabase: SupabaseClient): Promise<string | null> {
  const session = await auth()
  if (session?.user?.id) return session.user.id

  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}
```

- [ ] **Step 2: Update `app/(app)/layout.tsx`**

Replace:

```tsx
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
```

with:

```tsx
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  if (!userId) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
```

Add `import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'` alongside the existing imports.

- [ ] **Step 3: Update `app/(app)/dashboard/page.tsx`**

Replace:

```tsx
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
```

with:

```tsx
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  const [
    { data: profile },
    { data: callbacks },
    { data: followups },
    { data: customers },
    { data: notifications },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId!).single(),
    supabase.from('callbacks').select('*, customers(name, phone)').eq('agent_id', userId!).order('scheduled_at', { ascending: true }),
    supabase.from('followups').select('*, customers(name, phone)').eq('agent_id', userId!).order('created_at', { ascending: false }),
    supabase.from('customers').select('id').eq('created_by', userId!),
    supabase.from('notifications').select('id').eq('recipient_id', userId!).eq('read', false),
  ])
```

(Kept the `!` non-null assertion here since, unlike `layout.tsx`, this page never had an explicit `if (!user) redirect(...)` guard to begin with — it relies on `proxy.ts` having already guaranteed authentication. This matches the pre-existing `user!.id` pattern exactly, just swapping the identifier.)

Also update the later JSX usage: `userId={user!.id}` → `userId={userId!}` (one occurrence, in the `<Header>` component). Add the `getCurrentUserId` import.

- [ ] **Step 4: Apply the identical transformation to the remaining 9 files**

For each of `app/(app)/customers/page.tsx`, `app/(app)/callbacks/page.tsx`, `app/(app)/followups/page.tsx`, `app/(app)/roster/page.tsx`, `app/(app)/admin/layout.tsx`, `app/(app)/admin/page.tsx`, `app/(app)/admin/agents/page.tsx`, `app/(app)/admin/escalations/page.tsx`, `app/(app)/admin/requests/page.tsx` — read the file first, then apply the same rule used in Steps 2-3:

1. Add `import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'`.
2. Replace `const { data: { user } } = await supabase.auth.getUser()` with `const userId = await getCurrentUserId(supabase)`.
3. Replace every subsequent `user.id` with `userId` (if the file has an `if (!user) redirect(...)` or `if (!user)` guard before use, TypeScript narrows `userId` the same way it narrowed `user` — no `!` needed) or `user!.id` with `userId!` (if the file has no such guard, matching the file's existing non-null-assertion style — do not introduce a guard that wasn't there before, that's a behavior change outside this task's scope).
4. Replace any `if (!user) redirect(...)` with `if (!userId) redirect(...)`.
5. Leave everything else in each file completely untouched — this task changes nothing about queries, JSX structure, or business logic beyond the identifier swap.

`app/(app)/admin/requests/page.tsx` and `app/(app)/roster/page.tsx` both have an explicit `if (!user) redirect('/login')` guard (so their downstream references are unguarded `user.id`, no `!`); the rest (`customers`, `callbacks`, `followups`, `admin/layout`, `admin/page`, `admin/agents`, `admin/escalations`) do not have that guard and use `user!.id` throughout (relying on `proxy.ts`) — read each file to confirm which pattern it uses before editing, don't assume.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors across all 11 modified files plus the new helper.
Manual check: this is the first point in the plan where an Auth.js-authenticated user's dashboard load is actually possible to test meaningfully — but real end-to-end login still requires Task 11's user migration (to get a real `password_hash`) to be done first, so full verification is deferred to Task 12. For this task, confirm at minimum: `npm run dev`, log in via `/login/legacy` (still works, real Supabase Auth users exist), and click through every one of the 11 affected pages (dashboard, customers, callbacks, followups, roster, and — as admin — the 5 admin pages) confirming each loads without error. This exercises the helper's legacy-fallback branch on all 11 files, which is a real, meaningful regression check even though it doesn't yet prove the Auth.js branch (that needs Task 11 first).

- [ ] **Step 6: Commit**

```bash
git add lib/auth/getCurrentUserId.ts "app/(app)/layout.tsx" "app/(app)/dashboard/page.tsx" "app/(app)/customers/page.tsx" "app/(app)/callbacks/page.tsx" "app/(app)/followups/page.tsx" "app/(app)/roster/page.tsx" "app/(app)/admin/layout.tsx" "app/(app)/admin/page.tsx" "app/(app)/admin/agents/page.tsx" "app/(app)/admin/escalations/page.tsx" "app/(app)/admin/requests/page.tsx"
git commit -m "fix: stop calling supabase.auth.getUser() directly on pages, use getCurrentUserId helper"
```

---

### Task 8: Rewrite `app/api/admin/create-user/route.ts` — direct `profiles` insert, no more `auth.admin.createUser`

**Files:**
- Modify: `app/api/admin/create-user/route.ts`

**Interfaces:**
- Consumes: `hashPassword` from `lib/auth/password.ts` (Task 1); `createClient` from `@/lib/supabase/server` (Task 3, for the caller's own auth check — unchanged usage pattern).
- Produces: no new exports; this route's request/response shape (`POST` with `{ email, full_name, password, role, department }`, returns `{ success: true }` or `{ error }`) is unchanged, so no caller elsewhere needs updating.

- [ ] **Step 1: Rewrite the route**

Replace the full contents of `app/api/admin/create-user/route.ts` with:

```ts
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { hashPassword } from '@/lib/auth/password'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const session = await import('@/lib/auth/config').then(m => m.auth())
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, full_name, password, role, department } = await request.json()
  if (!email || !full_name || !password || !role) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const normalizedEmail = email.toLowerCase().trim()
  const { data: existing } = await adminSupabase.from('profiles').select('id').eq('email', normalizedEmail).single()
  if (existing) return NextResponse.json({ error: 'A user with that email already exists.' }, { status: 409 })

  const password_hash = await hashPassword(password)

  const { error } = await adminSupabase.from('profiles').insert({
    id: randomUUID(),
    email: normalizedEmail,
    full_name,
    role,
    department: department ?? null,
    password_hash,
    is_active: true,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
```

Note: the `await import('@/lib/auth/config').then(...)` dance for `auth()` is deliberate here — a plain top-level `import { auth } from '@/lib/auth/config'` would work equally well and is preferred; use that instead (`import { auth } from '@/lib/auth/config'` alongside the existing imports, then `const session = await auth()`). The dynamic-import form above is only there to make the dependency explicit in this plan text; do not transcribe it literally — use the static import.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors.
Manual check: log in as `admin` (via the legacy login page — Task 7 — since the new Credentials login won't work for existing users until Task 11), go to Manage Agents, create a new test user, confirm no error and the new row appears with a non-null `password_hash` (check via a quick service-role query or the Supabase dashboard's table editor). Then, separately, confirm that user can now log in via the **new** Auth.js login page (`/login`, not `/login/legacy`) — this is the first real proof the new Credentials path works end-to-end. Report exact observations.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/create-user/route.ts
git commit -m "feat: rewrite create-user route to insert profiles directly with password_hash"
```

---

### Task 9: Rewrite `review-password-reset` and `security-reset` routes — direct `password_hash` updates

**Files:**
- Modify: `app/api/admin/review-password-reset/route.ts`
- Modify: `app/api/auth/security-reset/route.ts`

**Interfaces:**
- Consumes: `hashPassword` from `lib/auth/password.ts` (Task 1).
- Produces: no new exports; both routes' request/response shapes are unchanged. `app/api/auth/request-password-reset/route.ts` needs **no changes at all** — it never called `.auth.admin.*`, confirmed by reading its current contents; do not touch it in this task.

- [ ] **Step 1: Rewrite `review-password-reset`**

Replace the full contents of `app/api/admin/review-password-reset/route.ts` with:

```ts
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { auth } from '@/lib/auth/config'
import { hashPassword } from '@/lib/auth/password'
import { NextResponse } from 'next/server'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pw = 'Tmp@'
  for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)]
  return pw
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: reviewer } = await supabase.from('profiles').select('role').eq('id', userId).single()
  if (reviewer?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { request_id, action } = await request.json()
  if (!request_id || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: resetReq, error: fetchErr } = await adminClient
    .from('password_reset_requests')
    .select('id, profile_id, status')
    .eq('id', request_id)
    .single()

  if (fetchErr || !resetReq) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
  if (resetReq.status !== 'pending') return NextResponse.json({ error: 'Request is no longer pending.' }, { status: 409 })

  if (action === 'reject') {
    await adminClient.from('password_reset_requests').update({
      status: 'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', request_id)
    return NextResponse.json({ success: true })
  }

  const tempPassword = generateTempPassword()
  const password_hash = await hashPassword(tempPassword)

  const { error: pwErr } = await adminClient
    .from('profiles')
    .update({ password_hash, force_password_change: true })
    .eq('id', resetReq.profile_id)

  if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })

  await adminClient.from('password_reset_requests').update({
    status: 'approved',
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
  }).eq('id', request_id)

  return NextResponse.json({ success: true, temp_password: tempPassword })
}
```

- [ ] **Step 2: Rewrite `security-reset`**

Replace the full contents of `app/api/auth/security-reset/route.ts` with:

```ts
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { hashPassword } from '@/lib/auth/password'
import { NextResponse } from 'next/server'

const SECURITY_ANSWER = 'let it rain'

export async function POST(request: Request) {
  const { email, answer, new_password } = await request.json()

  if (!email || !answer || !new_password) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  if (answer.trim().toLowerCase() !== SECURITY_ANSWER) {
    return NextResponse.json({ error: 'Incorrect answer. Please try again.' }, { status: 400 })
  }

  if (new_password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: profile, error: findErr } = await adminClient
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .single()

  if (findErr || !profile) {
    return NextResponse.json({ error: 'No account found with that email address.' }, { status: 404 })
  }

  const password_hash = await hashPassword(new_password)

  const { error: updateErr } = await adminClient
    .from('profiles')
    .update({ password_hash, force_password_change: false })
    .eq('id', profile.id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
```

Note: this is simpler than the original — it queries `profiles` by email directly instead of listing every Supabase Auth user to find a match, since `profiles.email` is now the only place email lives that matters for login.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors.
Manual check: exercise both routes' full UI flows (Admin → Requests → approve a password reset; and the login page's "Answer security question" flow) and confirm the resulting temp/new password actually works to log in via the new `/login` (Auth.js) page. Report exact observations.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/review-password-reset/route.ts app/api/auth/security-reset/route.ts
git commit -m "feat: rewrite password-reset routes to update profiles.password_hash directly"
```

---

### Task 10: Rewrite `Sidebar.tsx` and `change-password/page.tsx` — replace `supabase.auth.*` calls

**Files:**
- Modify: `components/layout/Sidebar.tsx`
- Modify: `app/(app)/change-password/page.tsx`
- Create: `app/api/profile/update/route.ts`

**Interfaces:**
- Consumes: `signOut` from `next-auth/react` (client-side); `hashPassword` from `lib/auth/password.ts`; `auth` from `lib/auth/config.ts`.
- Produces: `POST /api/profile/update` accepting `{ full_name?: string, email?: string, password?: string }` for the authenticated user, returns `{ success: true }` or `{ error }`. Both modified pages call this new route instead of `supabase.auth.updateUser(...)`.

- [ ] **Step 1: Add the profile-update route**

Create `app/api/profile/update/route.ts`:

```ts
import { auth } from '@/lib/auth/config'
import { hashPassword } from '@/lib/auth/password'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { full_name, email, password, clear_force_password_change } = await request.json()

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const updates: Record<string, unknown> = {}
  if (typeof full_name === 'string' && full_name.trim()) updates.full_name = full_name.trim()
  if (typeof email === 'string' && email.trim()) updates.email = email.toLowerCase().trim()
  if (typeof password === 'string' && password.length >= 8) updates.password_hash = await hashPassword(password)
  if (clear_force_password_change) updates.force_password_change = false

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { error } = await adminClient.from('profiles').update(updates).eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Rewrite `Sidebar.tsx`'s `handleLogout`, `saveProfile`, and `changePassword`**

In `components/layout/Sidebar.tsx`, add `import { signOut } from 'next-auth/react'` alongside the existing imports, and replace:

```tsx
  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }
```

with:

```tsx
  async function handleLogout() {
    await signOut({ redirect: false })
    router.push('/login')
    router.refresh()
  }
```

Replace the email-update block inside `saveProfile`:

```tsx
    if (updates.email) {
      const { error } = await supabase.auth.updateUser({ email: updates.email })
      if (error) { setProfileError(error.message); setProfileSaving(false); return }
      setProfileSuccess('Profile updated. Check your new email address to confirm the change.')
    } else {
      setProfileSuccess('Profile updated successfully.')
    }
```

with:

```tsx
    if (updates.email) {
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: updates.email }),
      })
      const data = await res.json()
      if (!res.ok) { setProfileError(data.error || 'Something went wrong.'); setProfileSaving(false); return }
      setProfileSuccess('Profile updated successfully.')
    } else {
      setProfileSuccess('Profile updated successfully.')
    }
```

(Note: this drops the "check your new email to confirm" messaging — Supabase's email-change confirmation flow was tied to Supabase Auth, which no longer owns email changes. The new route updates `profiles.email` immediately, no confirmation step. This is a deliberate, minor behavior simplification; flag it in your task report as a UX change worth the team's awareness, not a defect to fix yourself.)

Replace `changePassword`'s body:

```tsx
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pwForm.password })
    setPwSaving(false)

    if (error) { setPwError(error.message); return }
    setPwSuccess('Password updated successfully.')
    setPwForm({ password: '', confirm: '' })
```

with:

```tsx
    setPwSaving(true)
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwForm.password }),
    })
    const data = await res.json()
    setPwSaving(false)

    if (!res.ok) { setPwError(data.error || 'Something went wrong.'); return }
    setPwSuccess('Password updated successfully.')
    setPwForm({ password: '', confirm: '' })
```

- [ ] **Step 3: Rewrite `change-password/page.tsx`**

Replace the full contents of `app/(app)/change-password/page.tsx`'s `handleSubmit` (keep everything else — imports of `useState`/`useRouter`/icons, the JSX, the `inputCls` constant — unchanged except removing the now-unused `createClient` import and `supabase` variable):

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPw.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (newPw !== confirm) { setError('Passwords do not match.'); return }

    setSaving(true)

    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPw, clear_force_password_change: true }),
    })
    const data = await res.json()
    setSaving(false)

    if (!res.ok) { setError(data.error || 'Something went wrong.'); return }

    setDone(true)
    setTimeout(() => router.push('/dashboard'), 1500)
  }
```

Remove `import { createClient } from '@/lib/supabase/client'` and the `const supabase = createClient()` line from this file — nothing else on the page uses the Supabase client after this change.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — expect no errors.
Manual check: log in (new `/login` path, once Task 11 makes that possible for a real account — if Task 11 hasn't run yet, use `/login/legacy` for this check and note that in your report), open "My Account" from the Sidebar, change your name/email, confirm success. Then use `/change-password` directly (or trigger it via `force_password_change`) and confirm a new password actually lets you log back in afterward. Then click Sign out and confirm you land back on `/login`. Report exact observations for each.

- [ ] **Step 5: Commit**

```bash
git add components/layout/Sidebar.tsx "app/(app)/change-password/page.tsx" app/api/profile/update/route.ts
git commit -m "feat: replace supabase.auth.* calls in Sidebar and change-password page"
```

---

### Task 11: Delete obsolete OAuth callback route; migrate existing users to `force_password_change`

**Files:**
- Delete: `app/auth/callback/route.ts`
- Create: `scripts/migrate-existing-users-phase1.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: a one-off script (run once, not imported by anything) that sets `force_password_change = true` for every existing profile whose `password_hash` is still `NULL` — the final piece that makes the end-to-end grace-window flow (legacy login → forced `/change-password` → new password_hash set → new Auth.js login now works) actually reachable for real accounts.

- [ ] **Step 1: Delete the obsolete route**

Delete `app/auth/callback/route.ts` — it existed to complete Supabase's PKCE OAuth code exchange, which nothing in the app triggers anymore (the Microsoft button was removed in Task 6; Phase 1b's eventual Azure AD reimplementation uses Auth.js's own `/api/auth/callback/microsoft-entra-id` convention, handled automatically by the Task 2 route handler, not this file). Also remove the now-dead `pathname !== '/auth/callback'` exemptions added in `proxy.ts` (Task 5) — search `proxy.ts` for `/auth/callback` and delete that comparison from both conditions it appears in.

- [ ] **Step 2: Write the migration script**

Create `scripts/migrate-existing-users-phase1.mjs`, following the same `.env.local`-reading pattern as the existing `scripts/setup-dev-users.mjs`:

```js
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const projectRoot = path.resolve(import.meta.dirname, '..')
const envPath = path.join(projectRoot, '.env.local')

function loadEnvFile(filePath) {
  const file = fs.readFileSync(filePath, 'utf8')
  const env = {}
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue
    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

async function main() {
  const env = loadEnvFile(envPath)
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: rows, error: selectErr } = await adminClient
    .from('profiles')
    .select('id, email')
    .is('password_hash', null)

  if (selectErr) throw selectErr

  console.log(`Found ${rows.length} profile(s) with no password_hash yet:`)
  rows.forEach(r => console.log(`  - ${r.email}`))

  if (rows.length === 0) {
    console.log('Nothing to migrate.')
    return
  }

  const { error: updateErr } = await adminClient
    .from('profiles')
    .update({ force_password_change: true })
    .is('password_hash', null)

  if (updateErr) throw updateErr

  console.log(`\nSet force_password_change = true on ${rows.length} profile(s).`)
  console.log('Each of these users must log in via /login/legacy (their existing Supabase Auth')
  console.log('password still works there), which will redirect them to /change-password —')
  console.log('setting a new password there populates profiles.password_hash, after which they')
  console.log('can use the normal /login page going forward.')
}

main().catch(error => {
  console.error(`Migration failed: ${error.message}`)
  process.exitCode = 1
})
```

- [ ] **Step 3: Run the script and verify**

Run: `node scripts/migrate-existing-users-phase1.mjs` — report its console output in full (it lists every affected email).
Run: `npx tsc --noEmit` and `npm run lint` — expect no errors (confirm the `proxy.ts` edit in Step 1 didn't break anything).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-existing-users-phase1.mjs proxy.ts
git rm "app/auth/callback/route.ts"
git commit -m "chore: remove obsolete OAuth callback route, migrate existing users to force_password_change"
```

---

### Task 12: Full manual QA pass — end-to-end auth cutover verification

**Files:** none (verification only — if QA finds a bug, fix it in the relevant file from Tasks 1-11 and commit that fix separately with a clear message).

**Interfaces:** N/A.

- [ ] **Step 1: Confirm `SUPABASE_JWT_SECRET` and `AUTH_SECRET` are set**

Check `.env.local` has both. If `SUPABASE_JWT_SECRET` is still missing, this whole task is blocked — report that clearly rather than attempting partial verification.

- [ ] **Step 2: Full existing-user migration journey (one account, start to finish)**

Using `agent@carecms.local`: log in via `/login/legacy` with the existing password (`Agent123!`) → confirm redirect to `/change-password` (proving `force_password_change` from Task 11 works through the legacy path) → set a new password → confirm redirect to `/dashboard` with data loaded (proving the Task 3/4 `accessToken` JWT-minting round-trip actually works against live Supabase Postgres) → sign out → log back in via the **normal** `/login` page with the new password (proving the full Auth.js Credentials path works end-to-end). Report each step's concrete observation.

- [ ] **Step 3: Repeat Step 2's login-only portion for `admin` and `management` roles**

Using `admin@carecms.local` and `tylin.moodley@carecms.local` (or `management-dev@carecms.local` if `tylin.moodley`'s password is still unknown — same constraint as the console-desktop feature's QA pass) — confirm each role's landing experience is unchanged (admin/management still get the windowed console desktop from the earlier feature; role-gating on `/admin/*` still works for non-admins).

- [ ] **Step 4: Admin user-provisioning and password-reset flows**

Create a brand-new user via Admin → Manage Agents (Task 8), confirm they can log in immediately via the new `/login`. Submit a password-reset request as an agent, approve it as admin (Task 9), confirm the temp password logs the agent in and forces another password change.

- [ ] **Step 5: Data-access spot check across a few of the untouched 21 client-component files**

Pick 3-4 of the files from Task 4's "must keep working" list spanning different features (e.g. `CustomerManager.tsx`, `CallbackManager.tsx`, one roster admin modal) and confirm normal CRUD operations still work — proving the browser client's `accessToken` wiring (Task 4) is correct for write paths too, not just reads.

- [ ] **Step 6: Confirm the dual-login grace window itself**

Confirm `/login/legacy` still works for an account that HASN'T been migrated yet (if any remain) or note that all accounts were migrated in Task 11's run — either way, confirm the page itself still renders and is reachable (not blocked by `proxy.ts`).

- [ ] **Step 7: Final commit (only if QA fixes were made)**

If Steps 2-6 required any code fixes, ensure each was committed individually with a message describing the specific bug fixed. If everything passed with no fixes needed, say so clearly.

---

## Plan Self-Review

**Spec coverage:** Password hashing + migration (Task 1), Auth.js Credentials setup (Task 2), server/browser Supabase client JWT integration preserving all 21+15 untouched call sites (Tasks 3-4), proxy.ts dual-session support (Task 5), login page cutover (Task 6), dual-login grace window (Task 7), all 4 admin/auth API routes' `.auth.admin.*` removal (Tasks 8-9, with `request-password-reset` explicitly confirmed to need no change), `Sidebar.tsx`/`change-password` `.auth.*` removal (Task 10), cleanup + user migration (Task 11), end-to-end QA (Task 12) — every item from the approved architecture plan's Phase 1 description is covered. Azure AD SSO reimplementation is explicitly out of scope for this plan (deferred to "Phase 1b"), matching the architecture plan's own internal sequencing.

**Placeholder scan:** No TBD/TODO markers except the single intentional `{/* Microsoft sign-in returns in Phase 1b */}` UI comment (Task 6), which is a real, deliberate marker, not a placeholder for unfinished work in this plan. Task 5 explicitly calls out and instructs removal of a dead-code line drafted mid-plan, rather than silently leaving it — this is disclosure, not a placeholder.

**Type consistency:** `hashPassword`/`verifyPassword` (Task 1) used identically in Tasks 2, 8, 9, 10. `auth`/`handlers`/`signIn`/`signOut` (Task 2) used identically across Tasks 3-10. `mintSupabaseCompatibleJWT` (pre-existing, Phase 0) consumed identically in Tasks 3-4. `createClient()`'s signature is verified unchanged in both Task 3 (server, already-async) and Task 4 (browser, already-sync) — the reason 36 caller files across the codebase need zero changes.
