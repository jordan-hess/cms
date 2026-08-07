import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

/**
 * Lazily-initialized Drizzle client. Not exported directly — every caller
 * goes through lib/db/withUserContext.ts's withUserContext()/withServiceRole()
 * so current_uid() (see supabase/neon/001_initial_schema.sql) always resolves
 * correctly inside RLS policies. Lazy init means importing this module (or
 * anything that imports it) doesn't throw just because DATABASE_URL isn't
 * set yet — it only throws when a query is actually attempted.
 */
let cached: PostgresJsDatabase | null = null

export function getDb(): PostgresJsDatabase {
  if (cached) return cached

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Point it at the Neon (or other Postgres) connection string ' +
      'once Phase 0 infrastructure exists.'
    )
  }

  cached = drizzle(postgres(url, { max: 10 }))
  return cached
}
