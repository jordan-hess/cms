import { createClient as createAdminClient } from '@supabase/supabase-js'
import { hashPassword } from '@/lib/auth/password'
import { NextResponse } from 'next/server'

const SECURITY_ANSWER = 'let it rain'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { email, answer, new_password } = body as { email?: unknown; answer?: unknown; new_password?: unknown }

  if (typeof email !== 'string' || typeof answer !== 'string' || typeof new_password !== 'string') {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  if (!email || !answer || !new_password) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  if (answer.trim().toLowerCase() !== SECURITY_ANSWER) {
    return NextResponse.json({ error: 'Incorrect answer. Please try again.' }, { status: 400 })
  }

  if (new_password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: profile, error: findErr } = await adminClient
    .from('profiles')
    .select('id')
    .ilike('email', email.toLowerCase().trim())
    .single()

  if (findErr && findErr.code !== 'PGRST116') {
    // A genuine DB error (timeout, connection issue, etc.) rather than "no rows" -
    // log it internally, but still return the same generic response as the
    // not-found case so we never leak account existence to the client.
    console.error('security-reset: error looking up profile by email', findErr)
  }

  if (findErr || !profile) {
    // Hash a dummy value to keep response timing consistent with the
    // found-account path (bcrypt ~250ms), and return a generic success so
    // this endpoint never reveals whether an email is registered - matching
    // the policy in app/api/auth/request-password-reset/route.ts.
    await hashPassword(new_password)
    return NextResponse.json({ success: true })
  }

  const password_hash = await hashPassword(new_password)

  const { error: updateErr } = await adminClient
    .from('profiles')
    .update({ password_hash, force_password_change: false })
    .eq('id', profile.id)

  if (updateErr) {
    console.error('security-reset: failed to update profiles.password_hash', updateErr)
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }

  // Best-effort sync of the same password into the legacy Supabase Auth
  // credential so the account can't still be logged into via /login/legacy
  // with the old (compromised) password during the dual-login grace window.
  // Not every profile has a corresponding auth.users row (e.g. users created
  // after the FK-drop migration), so a failure here must not fail the request.
  try {
    const { error: legacySyncErr } = await adminClient.auth.admin.updateUserById(profile.id, { password: new_password })
    if (legacySyncErr) {
      console.error('security-reset: failed to sync password to legacy Supabase Auth user', legacySyncErr)
    }
  } catch (legacySyncErr) {
    console.error('security-reset: failed to sync password to legacy Supabase Auth user', legacySyncErr)
  }

  return NextResponse.json({ success: true })
}
