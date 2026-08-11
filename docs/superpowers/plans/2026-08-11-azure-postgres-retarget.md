# Azure Postgres Retarget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retarget the dormant "Phase 0" Postgres migration scaffolding from Neon to Azure Database for PostgreSQL (a "SIT" environment tier) — naming, comments, and connection defaults only, since the underlying code was always vendor-neutral standard Postgres with no logic to change.

**Architecture:** A single cohesive rename-and-relabel pass across the 3 scaffold files plus 2 documentation touch-ups. No new files, no deleted functionality, no dependency changes — every edit is textual (a path, a role-name example, a connection option default) with zero behavioral change to any live code path, since this scaffolding isn't wired into any live route yet.

**Tech Stack:** Drizzle ORM, `postgres.js` (unchanged), Markdown docs.

## Global Constraints

- No live Azure Database for PostgreSQL instance exists yet — there is nothing to connect to or verify end-to-end. Verification in this plan is limited to typecheck, grep-for-stray-references, and confirming no content was lost in the file move.
- Zero logic changes anywhere — every change is a rename, a comment/string update, or a connection-option default (`ssl: 'require'`). Do not "improve" or refactor anything else while touching these files.
- The already-merged `docs/superpowers/plans/2026-08-07-phase1-auth-cutover.md` is historical record and must not be modified.
- No `package.json`/dependency changes — `postgres.js` and Drizzle already work identically against Azure Database for PostgreSQL.

---

### Task 1: Retarget scaffolding from Neon to Azure Database for PostgreSQL

**Files:**
- Rename (git mv): `supabase/neon/001_initial_schema.sql` → `supabase/postgres/001_initial_schema.sql`
- Modify: `lib/db/client.ts`
- Modify: `lib/db/withUserContext.ts`
- Modify: `.env.local.example`
- Modify: `CLAUDE.md`

**Interfaces:** None — this task has no interfaces consumed by or produced for any other task. It is the only task in this plan.

- [ ] **Step 1: Rename the schema file, preserving git history**

```bash
mkdir -p supabase/postgres
git mv supabase/neon/001_initial_schema.sql supabase/postgres/001_initial_schema.sql
```

The old `supabase/neon/` directory should now be empty and can be left to disappear naturally (git doesn't track empty directories) — do not `rmdir` it manually if the `git mv` already leaves it empty; if it's not empty afterward, something went wrong and needs investigating before continuing.

- [ ] **Step 2: Update the schema file's header comment**

In `supabase/postgres/001_initial_schema.sql`, change line 2 from:

```sql
-- Neon-target consolidated schema (Phase 0 of the Supabase migration)
```

to:

```sql
-- Azure Database for PostgreSQL (SIT) target: consolidated schema (Phase 0 of the Supabase migration)
```

- [ ] **Step 3: Fix the pre-existing "Neon-specific" misnomer in the same file**

Change:

```sql
-- ─── Neon-specific: identity plumbing that Supabase normally provides ─────
```

to:

```sql
-- ─── Plain-Postgres identity plumbing that Supabase normally provides ─────
```

This section (the `current_uid()` function and the `authenticated`/`service_role` roles a few lines below it) was never actually Neon-specific — it's needed identically on any plain Postgres without Supabase's platform underneath, including Azure. The old label would mislead a future reader into thinking this plumbing is Neon-only and needs replacing; it doesn't.

- [ ] **Step 4: Update the connection-role example near the end of the same file**

Change:

```sql
-- The app's actual Neon connection role must be granted membership in both
-- roles once known, e.g.: GRANT authenticated, service_role TO neondb_owner;
-- (substitute the real role name Neon assigns). Left as a manual step since
-- that role name doesn't exist until the Neon project is created.
```

to:

```sql
-- The app's actual Azure Database for PostgreSQL connection role must be
-- granted membership in both roles once known, e.g.:
-- GRANT authenticated, service_role TO <your-admin-username>;
-- (substitute the actual admin username chosen when the Azure Postgres
-- Flexible Server instance is provisioned). Left as a manual step since
-- that role name doesn't exist until the instance is created.
```

- [ ] **Step 5: Update `lib/db/client.ts`**

Change the module doc comment's file-path reference from:

```
current_uid() (see supabase/neon/001_initial_schema.sql) always resolves
```

to:

```
current_uid() (see supabase/postgres/001_initial_schema.sql) always resolves
```

Change the thrown error message from:

```ts
    throw new Error(
      'DATABASE_URL is not set. Point it at the Neon (or other Postgres) connection string ' +
      'once Phase 0 infrastructure exists.'
    )
```

to:

```ts
    throw new Error(
      'DATABASE_URL is not set. Point it at the Azure Database for PostgreSQL (SIT) ' +
      'connection string once Phase 0 infrastructure exists.'
    )
```

Change the client construction line from:

```ts
  cached = drizzle(postgres(url, { max: 10 }))
```

to:

```ts
  // Azure Database for PostgreSQL Flexible Server enforces SSL by default.
  cached = drizzle(postgres(url, { max: 10, ssl: 'require' }))
```

- [ ] **Step 6: Update `lib/db/withUserContext.ts`**

This file references `supabase/neon/001_initial_schema.sql` in two separate doc comments (one near the top of `withUserContext`'s comment block, one in `withServiceRole`'s comment block). Change both occurrences from `supabase/neon/001_initial_schema.sql` to `supabase/postgres/001_initial_schema.sql`. No other change — the transaction/RLS mechanism itself (the `SET LOCAL` calls, the callback shapes) is untouched.

- [ ] **Step 7: Add the `DATABASE_URL` placeholder to `.env.local.example`**

Add these 3 lines at the end of the file (after the existing `SUPABASE_JWT_SECRET=` line):

```
# Phase 0 (dormant): Azure Database for PostgreSQL connection string, once a SIT instance exists.
# Shape: postgresql://<user>:<password>@<server-name>.postgres.database.azure.com:5432/<dbname>?sslmode=require
DATABASE_URL=
```

- [ ] **Step 8: Add the dormant-scaffold note to `CLAUDE.md`**

Add this new subsection immediately after the existing "Database schema" section's last paragraph (the one ending with the `Foreign key joins use Supabase's inline select syntax:` code block) — i.e., append it as a new section at the end of the "Database schema" content, still nested under the same "Architecture" heading level as its siblings:

```markdown
### Future migration scaffolding (dormant)

`lib/db/client.ts`, `lib/db/withUserContext.ts`, and `supabase/postgres/001_initial_schema.sql` are unused-today groundwork for a planned future move off Supabase Postgres, targeting Azure Database for PostgreSQL (a "SIT" environment tier). Nothing in the live app imports these files yet — `DATABASE_URL` is unset, and no route uses them. Do not treat their presence as evidence the app has actually migrated.
```

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors from branch source. (`ssl: 'require'` is a valid `postgres.js` `Options` field, so this should be a pure non-issue, but confirm.)

- [ ] **Step 10: Confirm no stray references remain**

Run a repo-wide case-insensitive search for the old path and confirm it returns nothing:

```bash
grep -ril "supabase/neon" . --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.md"
```

Expected: no output (empty result). If anything other than this plan document or the design spec document itself matches, that's a real gap — every functional file (`lib/db/client.ts`, `lib/db/withUserContext.ts`, the schema file itself) must have zero remaining references to the old path. (The plan and spec documents themselves quote the OLD text deliberately, as part of their own before/after diffs — those are expected matches and not a problem; only flag matches in `.ts`/`.sql` source files or `CLAUDE.md`.)

- [ ] **Step 11: Confirm the renamed schema file wasn't corrupted by the move**

Run: `git diff --stat HEAD -- supabase/postgres/001_initial_schema.sql`

Since this is a tracked rename with only 3 small text edits (Steps 2-4), the diff stat should show a small number of changed lines (roughly 8-12, accounting for the 3 multi-line comment blocks changed), not a wholesale rewrite. If the diff looks like the entire file changed, something went wrong in the edit — stop and investigate rather than committing.

- [ ] **Step 12: Commit**

```bash
git add supabase/postgres/001_initial_schema.sql lib/db/client.ts lib/db/withUserContext.ts .env.local.example CLAUDE.md
git status --short
```

Confirm `git status --short` shows `supabase/neon/001_initial_schema.sql` as deleted (`D`) and `supabase/postgres/001_initial_schema.sql` as added (`A`) — or, if the working tree still shows it as a rename (`R`), that's fine too; both are acceptable outcomes of `git mv` plus subsequent edits. Then:

```bash
git commit -m "$(cat <<'EOF'
chore: retarget Phase 0 Postgres scaffolding from Neon to Azure

No live SIT instance exists yet — this is naming/comment/connection-
default updates only. The scaffolding was always vendor-neutral
standard Postgres (postgres.js + Drizzle, stock SQL/roles/GUCs), so
no logic changes were needed.
EOF
)"
```

No further tasks — this is the entire plan.
