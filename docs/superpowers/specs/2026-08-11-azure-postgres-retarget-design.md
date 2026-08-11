# Retarget Phase 0 Postgres Scaffolding from Neon to Azure Database for PostgreSQL

## Context

An earlier "Phase 0" of the Supabase migration added dormant scaffolding for a future move off Supabase Postgres: `lib/db/client.ts` (a lazily-initialized Drizzle client over the `postgres.js` driver), `lib/db/withUserContext.ts` (a `SET LOCAL app.current_user_id`/`SET LOCAL ROLE service_role` wrapper that makes a `current_uid()` Postgres function behave like Supabase's `auth.uid()` for RLS), and `supabase/neon/001_initial_schema.sql` (a consolidated, vendor-neutral port of every table/policy currently live in Supabase). None of this is wired into any live route yet — `DATABASE_URL` is unset, and the code's own comments say so explicitly ("NOT YET VERIFIED END-TO-END... Neon setup was deferred").

The user's company only accepts Azure Database for PostgreSQL (specifically, a "SIT" — System Integration Testing — environment tier) as a hosting target, not Neon. No SIT instance is provisioned yet, so this is codebase preparation only: retarget the naming, comments, and connection defaults so the scaffolding accurately reflects and is ready for Azure, with nothing to actually connect and verify until an instance exists.

I verified directly, rather than assuming, that this scaffolding has no Neon-proprietary dependency to unwind:
- `lib/db/client.ts` uses `postgres` (the `postgres.js` TCP driver) via Drizzle's `drizzle-orm/postgres-js` adapter — not `@neondatabase/serverless` or any Neon-specific edge/HTTP driver. `package.json` confirms `@neondatabase/serverless` isn't even an installed dependency (it only appears as one of Drizzle's ~20 optional peer-dependency entries in `package-lock.json`, alongside `pg`, `mysql2`, etc. — never resolved or imported).
- `lib/db/withUserContext.ts`'s RLS-equivalent mechanism (`SET LOCAL app.current_user_id`, `SET LOCAL ROLE service_role`) is pure Postgres transaction/role semantics, portable to any Postgres.
- `supabase/neon/001_initial_schema.sql`'s only extensions are `uuid-ossp` and `pgcrypto`, both stock and both available on Azure Database for PostgreSQL. A grep for actual Neon-proprietary SQL (branching constructs, `neon_utils`, Neon-specific extensions) returns zero hits — every "Neon" occurrence in the file is the word "Neon" in a comment or the literal role name `neondb_owner` (Neon's default connection role, referenced only as an example in a comment about a manual grant step), never actual platform-coupled SQL.

This was scoped through a clarifying-questions pass; the below reflects the user's explicit choices:
- No live Azure instance exists yet — this change touches naming/comments/connection defaults only, with no connection to actually test.
- The schema file's new home is `supabase/postgres/` (vendor-neutral), not `supabase/azure/` — since the SQL itself has never been platform-specific, a generic name avoids yet another rename if the target ever changes again.
- `CLAUDE.md` gains a short new note about this dormant scaffold's existence and current target, since nothing in that file mentions it today and a future reader would otherwise have no way to know why unused DB code sits in the tree.

## Key decisions

- **No logic changes anywhere** — every change in this plan is a rename, a comment update, or a connection-option default. The RLS-equivalent mechanism, the Drizzle/postgres.js usage, and the schema's tables/policies/roles are unchanged.
- **`ssl: 'require'` becomes the connection default**, not optional or environment-gated. Azure Database for PostgreSQL Flexible Server enforces SSL by default; Neon's own defaults happened to work without an explicit flag, but that's no longer the target. Since there's no other live target this code needs to support today, hardcoding it is simpler than adding configurability nothing currently uses.
- **The stray "Neon-specific" label on the identity-plumbing section header is a pre-existing misnomer, fixed as part of this pass** — that plumbing (the `current_uid()` function, the `authenticated`/`service_role` roles) was never actually Neon-specific; it's "plain-Postgres-without-Supabase's-platform" plumbing, needed identically on Azure. Leaving the old label would actively mislead a future reader into thinking it's Neon-only and needs replacing — it doesn't.
- **The `neondb_owner` example in the grants comment is replaced with a generic placeholder**, not a real Azure role name — Azure Database for PostgreSQL Flexible Server's admin username is whatever the provisioner chooses at creation time (no fixed default like Neon's `neondb_owner`), so the comment should say so rather than inventing a fake Azure-equivalent name.
- **`.env.local.example` gets a documented, empty `DATABASE_URL` line** showing the Azure connection-string shape as a comment, matching how every other env var in that file is already just a bare `KEY=` line — discoverable once a real instance exists, without implying one exists now.
- **The already-merged Phase 1 auth-cutover plan document is not touched** — it's historical record of already-completed work, and its own claim ("Postgres stays on Supabase this phase") remains true regardless of what Phase 0's future target is.

## Files touched

**`supabase/neon/001_initial_schema.sql` → renamed to `supabase/postgres/001_initial_schema.sql`**, with these text changes:
- Line 2 header: `-- Neon-target consolidated schema (Phase 0 of the Supabase migration)` → `-- Azure Database for PostgreSQL (SIT) target: consolidated schema (Phase 0 of the Supabase migration)`
- Line 50 section header: `-- ─── Neon-specific: identity plumbing that Supabase normally provides ─────` → `-- ─── Plain-Postgres identity plumbing that Supabase normally provides ─────` (fixing the pre-existing misnomer described above)
- Lines 787-790:
  ```sql
  -- The app's actual Neon connection role must be granted membership in both
  -- roles once known, e.g.: GRANT authenticated, service_role TO neondb_owner;
  -- (substitute the real role name Neon assigns). Left as a manual step since
  -- that role name doesn't exist until the Neon project is created.
  ```
  becomes:
  ```sql
  -- The app's actual Azure Database for PostgreSQL connection role must be
  -- granted membership in both roles once known, e.g.:
  -- GRANT authenticated, service_role TO <your-admin-username>;
  -- (substitute the actual admin username chosen when the Azure Postgres
  -- Flexible Server instance is provisioned). Left as a manual step since
  -- that role name doesn't exist until the instance is created.
  ```

**`lib/db/client.ts`**:
- The `current_uid()` file-path reference in the module doc comment updates from `supabase/neon/001_initial_schema.sql` to `supabase/postgres/001_initial_schema.sql`.
- The thrown error message changes from `'DATABASE_URL is not set. Point it at the Neon (or other Postgres) connection string once Phase 0 infrastructure exists.'` to `'DATABASE_URL is not set. Point it at the Azure Database for PostgreSQL (SIT) connection string once Phase 0 infrastructure exists.'`
- The `postgres(url, { max: 10 })` call becomes `postgres(url, { max: 10, ssl: 'require' })`, with a one-line comment noting Azure Database for PostgreSQL Flexible Server enforces SSL by default.

**`lib/db/withUserContext.ts`**: both `supabase/neon/001_initial_schema.sql` path references in doc comments update to `supabase/postgres/001_initial_schema.sql`. No other change — the transaction/RLS mechanism itself is untouched.

**`.env.local.example`**: add one new line after the existing `SUPABASE_JWT_SECRET=` line:
```
# Phase 0 (dormant): Azure Database for PostgreSQL connection string, once a SIT instance exists.
# Shape: postgresql://<user>:<password>@<server-name>.postgres.database.azure.com:5432/<dbname>?sslmode=require
DATABASE_URL=
```

**`CLAUDE.md`**: add a new short paragraph after the existing "Database schema" section's last line (after the "Foreign key joins use..." code block), documenting the dormant scaffold:
```markdown
### Future migration scaffolding (dormant)

`lib/db/client.ts`, `lib/db/withUserContext.ts`, and `supabase/postgres/001_initial_schema.sql` are unused-today groundwork for a planned future move off Supabase Postgres, targeting Azure Database for PostgreSQL (a "SIT" environment tier). Nothing in the live app imports these files yet — `DATABASE_URL` is unset, and no route uses them. Do not treat their presence as evidence the app has actually migrated.
```

## Files explicitly NOT modified (and why)

- `docs/superpowers/plans/2026-08-07-phase1-auth-cutover.md` — completed, merged historical record; its claims about that phase remain accurate regardless of Phase 0's target platform.
- `package.json` / `package-lock.json` — no dependency changes; `postgres.js` and Drizzle already work identically against Azure.
- Every live Supabase Auth/DB code path (`lib/supabase/*`, `proxy.ts`, every page/component) — this scaffolding is entirely dormant and parallel to the live app; nothing here reads from or writes to it.

## Verification approach

No automated test suite exists in this project (per `CLAUDE.md`). Since no live Azure instance exists, there is no live connection to test. Verification is limited to:
- `npx tsc --noEmit` passes (the `ssl: 'require'` option is a valid `postgres.js` connection option, so this should be a pure type-level non-issue, but confirm anyway).
- Confirm no remaining references to the old `supabase/neon/` path anywhere in the repo (`grep -ri "supabase/neon"` returns nothing).
- Confirm the renamed file's content is otherwise byte-identical apart from the specific text changes listed above (i.e., no accidental content loss/corruption during the rename).
- A future task, once a real SIT instance exists, will need to actually set `DATABASE_URL` and exercise `withUserContext()`/`withServiceRole()` against it — this plan does not attempt that, since there's nothing to connect to yet.
