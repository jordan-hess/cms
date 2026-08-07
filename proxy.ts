import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/lib/auth/config'
import { createClient } from '@/lib/supabase/server'

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
  // (see .superpowers/sdd/2026-08-07-phase1-auth-cutover, Task 7).
  // Remove this whole branch once the grace window closes.
  let legacySupabase: Awaited<ReturnType<typeof getLegacySupabaseUser>>['supabase'] | null = null
  if (!userId) {
    const legacy = await getLegacySupabaseUser(request, response)
    if (legacy.user) {
      userId = legacy.user.id
      legacySupabase = legacy.supabase
    }
  }

  if (!userId && pathname !== '/login' && pathname !== '/login/legacy' && !pathname.startsWith('/api/') && pathname !== '/auth/callback') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (userId && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  if (userId && !pathname.startsWith('/api/') && pathname !== '/change-password') {
    // Reuse the already-authenticated legacy client when the fallback path matched;
    // otherwise fall back to the Auth.js-backed Supabase client (Task 3).
    const client = legacySupabase ?? await createClient()

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
