import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { getDb } from './client'

/**
 * The single choke point every write path (Server Components, API routes,
 * the dev seed script) must go through instead of importing getDb()
 * directly — this is what makes current_uid() (see
 * supabase/postgres/001_initial_schema.sql) resolve correctly inside RLS
 * policies, preserving the "authorization holds regardless of call path"
 * guarantee the original Supabase/RLS design had. See "The RLS decision" in
 * the migration plan for why this replaces app-layer-only checks rather
 * than sitting alongside them as the primary enforcement.
 *
 * SET LOCAL is transaction-scoped (resets automatically at COMMIT/ROLLBACK),
 * so it must run inside the same transaction as the actual query — hence
 * the callback shape rather than a plain "set it and move on" call.
 *
 * NOT YET VERIFIED END-TO-END: there is no live Postgres connection in this
 * environment yet (Neon setup was deferred). This has been written
 * correctly against the Drizzle/postgres-js API but the actual
 * SET LOCAL + RLS enforcement round-trip needs to be exercised against a
 * real database before Phase 0 can be considered complete — see the plan's
 * verification section.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (tx: PostgresJsDatabase) => Promise<T>
): Promise<T> {
  const db = getDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.current_user_id = ${userId}`)
    return fn(tx as unknown as PostgresJsDatabase)
  })
}

/**
 * Escape hatch for the one legitimate no-user-context case: service-role
 * scripts that must bypass per-user RLS entirely (e.g. the eventual
 * replacement for scripts/setup-dev-users.mjs). Requires the `service_role`
 * Postgres role (BYPASSRLS, created in supabase/postgres/001_initial_schema.sql)
 * to exist and the app's connecting role to have been granted membership in
 * it. Named loudly and intended to be used nowhere else, mirroring this
 * repo's existing "service-role client constructed in exactly one place"
 * convention for the Supabase admin client.
 */
export async function withServiceRole<T>(fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
  const db = getDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE service_role`)
    return fn(tx as unknown as PostgresJsDatabase)
  })
}
