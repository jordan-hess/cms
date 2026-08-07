import type { SupabaseClient } from '@supabase/supabase-js'
import { auth } from './config'

/**
 * Resolves the current user's id from whichever session is active.
 *
 * `lib/supabase/server.ts`'s createClient() returns one of three client
 * shapes depending on which session (if any) authenticated the request:
 *  1. Auth.js session present — the Auth.js-JWT-minting client (accessToken
 *     option set to a function that mints a token). This is the common case
 *     going forward, and is resolved directly from the Auth.js session below
 *     without touching the Supabase client at all.
 *  2. No Auth.js session, but a still-valid legacy Supabase session — the
 *     raw legacy-session client (accessToken NOT set, .auth fully
 *     functional). `supabase.auth.getUser()` works fine here.
 *  3. Neither session exists (fully logged out, or a session that expired
 *     between proxy.ts's check and this page rendering) — createClient()
 *     still sets accessToken (to a function that resolves to null), so
 *     Supabase still installs its throwing .auth Proxy on this client too.
 *     `supabase.auth.getUser()` throws in this case rather than returning
 *     no user, so it's wrapped in try/catch and treated as "no user".
 *
 * Net effect: this function checks the Auth.js session first, and only
 * falls back to `supabase.auth.getUser()` when there is no Auth.js session
 * — returning `null` for both "no user" cases (2's negative result and all
 * of case 3), so callers can rely on `null` meaning "not authenticated"
 * without ever seeing this throw.
 */
export async function getCurrentUserId(supabase: SupabaseClient): Promise<string | null> {
  const session = await auth()
  if (session?.user?.id) return session.user.id

  try {
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}
