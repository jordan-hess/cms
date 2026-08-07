import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth/config'
import { mintSupabaseCompatibleJWT } from '@/lib/auth/jwt'

// Grace-window fallback: accept a still-valid legacy Supabase session
// (see .superpowers/sdd/2026-08-07-phase1-auth-cutover, Task 7 amendment).
// Without this, a legacy-session user passes proxy.ts's gate but every RLS
// policy (all `TO authenticated`) would reject their queries, since this
// factory would otherwise only ever mint tokens from an Auth.js session.
// Remove this whole branch once the grace window closes.
async function getLegacySupabaseClient(): Promise<SupabaseClient | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // `setAll` was called from a Server Component, which can't set
            // cookies. Safe to ignore as long as proxy.ts is refreshing
            // sessions on the request path.
          }
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  return user ? supabase : null
}

export async function createClient(): Promise<SupabaseClient> {
  const session = await auth()
  const userId = session?.user?.id

  if (userId) {
    const email = session?.user?.email ?? undefined
    return createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        accessToken: async () => mintSupabaseCompatibleJWT(userId, { email }),
      }
    )
  }

  const legacyClient = await getLegacySupabaseClient()
  if (legacyClient) return legacyClient

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => null,
    }
  )
}
