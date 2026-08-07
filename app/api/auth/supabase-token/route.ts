import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth/config'
import { mintSupabaseCompatibleJWT } from '@/lib/auth/jwt'
import { TOKEN_LIFETIME_SECONDS } from '@/lib/auth/supabase-token-constants'

// Grace-window fallback: accept a still-valid legacy Supabase session
// (see .superpowers/sdd/2026-08-07-phase1-auth-cutover, Task 7 amendment).
// Without this, a legacy-session user's browser client (lib/supabase/client.ts,
// which fetches this route for its accessToken) would get a 401 here and fall
// back to unauthenticated requests, even though proxy.ts let them past the
// login wall. Remove this whole branch once the grace window closes.
async function getLegacySupabaseAccessToken(): Promise<string | null> {
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
            // Ignorable outside a context that can set cookies.
          }
        },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id

  if (userId) {
    const token = await mintSupabaseCompatibleJWT(userId, { email: session?.user?.email ?? undefined, expiresInSeconds: TOKEN_LIFETIME_SECONDS })
    return NextResponse.json({ token })
  }

  const legacyToken = await getLegacySupabaseAccessToken()
  if (legacyToken) return NextResponse.json({ token: legacyToken })

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
