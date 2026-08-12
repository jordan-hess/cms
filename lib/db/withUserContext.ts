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
 * Uses set_config(), not `SET LOCAL app.current_user_id = ${userId}` — the
 * SET command is a utility statement and does not accept bind parameters at
 * all (confirmed by actually running it: Postgres rejects `SET LOCAL x = $1`
 * outright). set_config()'s third argument (`is_local => true`) is the
 * parameterizable equivalent of SET LOCAL.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (tx: PostgresJsDatabase) => Promise<T>
): Promise<T> {
  const db = getDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`)
    return fn(tx as unknown as PostgresJsDatabase)
  })
}

/**
 * Escape hatch for the one legitimate no-user-context case: service-role
 * scripts that must bypass per-user RLS entirely (e.g. the eventual
 * replacement for scripts/setup-dev-users.mjs).
 *
 * There is no `service_role` Postgres role here — the target environment's
 * connecting role cannot CREATE ROLE (company policy), so every RLS policy
 * in supabase/postgres/001_initial_schema.sql ORs in
 * `current_setting('app.bypass_rls', true) = 'true'` instead of checking
 * role membership. Setting this GUC reproduces the same full-bypass
 * guarantee a BYPASSRLS role would have given, without needing one. Named
 * loudly and intended to be used nowhere else, mirroring this repo's
 * existing "service-role client constructed in exactly one place"
 * convention for the Supabase admin client.
 */
export async function withServiceRole<T>(fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
  const db = getDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.bypass_rls = 'true'`)
    return fn(tx as unknown as PostgresJsDatabase)
  })
}
