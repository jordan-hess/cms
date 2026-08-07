import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { hashPassword } from '@/lib/auth/password'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse, after } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { full_name, email, password, clear_force_password_change } = body as {
    full_name?: unknown
    email?: unknown
    password?: unknown
    clear_force_password_change?: unknown
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const updates: Record<string, unknown> = {}
  if (typeof full_name === 'string' && full_name.trim()) updates.full_name = full_name.trim()
  if (typeof email === 'string' && email.trim()) updates.email = email.toLowerCase().trim()
  if (typeof password === 'string' && password.length >= 8) updates.password_hash = await hashPassword(password)
  if (clear_force_password_change) updates.force_password_change = false

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { error } = await adminClient.from('profiles').update(updates).eq('id', userId)
  if (error) {
    console.error('profile/update: failed to update profiles', error)
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }

  // Best-effort sync of the same password/email into the legacy Supabase Auth
  // credential so a self-service change (often made *because* the old password
  // is suspected leaked) can't be left valid at /login/legacy for the rest of
  // the dual-login grace window. Not every profile has a corresponding
  // auth.users row (e.g. users created after Task 8's FK-drop migration), so a
  // failure here must not fail the request. Deferred via after() since this
  // route is authenticated (no timing-oracle concern), purely so the caller
  // doesn't wait on a GoTrue round-trip whose result doesn't affect the response.
  const legacySyncPayload: { password?: string; email?: string } = {}
  if (typeof password === 'string' && password.length >= 8) legacySyncPayload.password = password
  if (typeof email === 'string' && email.trim()) legacySyncPayload.email = email.toLowerCase().trim()

  if (Object.keys(legacySyncPayload).length > 0) {
    after(async () => {
      try {
        const { error: legacySyncErr } = await adminClient.auth.admin.updateUserById(userId, legacySyncPayload)
        if (legacySyncErr) console.error('profile/update: legacy auth sync failed', legacySyncErr)
      } catch (e) {
        console.error('profile/update: legacy auth sync threw', e)
      }
    })
  }

  return NextResponse.json({ success: true })
}
