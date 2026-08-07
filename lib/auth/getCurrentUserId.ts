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
