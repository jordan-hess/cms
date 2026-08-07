import { createClient as createAdminClient } from '@supabase/supabase-js'
import { hashPassword } from '@/lib/auth/password'
import { NextResponse } from 'next/server'

const SECURITY_ANSWER = 'let it rain'

async function respondPadded(body: unknown, status: number, startedAt: number) {
  const MIN_MS = 1200
  const elapsed = Date.now() - startedAt
  if (elapsed < MIN_MS) await new Promise((r) => setTimeout(r, MIN_MS - elapsed))
  return NextResponse.json(body, { status })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
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

  const startedAt = Date.now()

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // .ilike() performs zero escaping of LIKE wildcards (%, _) or PostgREST's
  // own `*` wildcard alias - passing the caller's input through unescaped
  // would let an attacker match many accounts with a single prefix/suffix
  // pattern (e.g. "admin%") instead of needing the exact target email.
  // Escape wildcard metacharacters before sending the pattern to Postgres,
  // then re-verify the returned row's email exactly matches (case-insensitively)
  // the normalized input in application code - never trust the LIKE result alone.
  const normalizedEmail = email.toLowerCase().trim()
  const escapedEmail = normalizedEmail.replace(/[\\%_*]/g, '\\$&')

  const { data: profile, error: findErr } = await adminClient
    .from('profiles')
    .select('id, email')
    .ilike('email', escapedEmail)
    .single()

  if (findErr && findErr.code !== 'PGRST116') {
    // A genuine DB error (timeout, connection issue, etc.) rather than "no rows" -
    // log it internally, but still return the same generic response as the
    // not-found case so we never leak account existence to the client.
    console.error('security-reset: error looking up profile by email', findErr)
  }

  const matchedProfile = profile && profile.email.toLowerCase().trim() === normalizedEmail ? profile : null

  if (!matchedProfile) {
    // Hash a dummy value to keep response timing consistent with the
    // found-account path (bcrypt ~250ms), and return a generic success so
    // this endpoint never reveals whether an email is registered - matching
    // the policy in app/api/auth/request-password-reset/route.ts. The response
    // is additionally padded to a constant floor below to mask the extra
    // latency the found-account path incurs from the legacy Auth sync call.
    await hashPassword(new_password)
    return await respondPadded({ success: true }, 200, startedAt)
  }

  const password_hash = await hashPassword(new_password)

  const { error: updateErr } = await adminClient
    .from('profiles')
    .update({ password_hash, force_password_change: false })
    .eq('id', matchedProfile.id)

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
    const { error: legacySyncErr } = await adminClient.auth.admin.updateUserById(matchedProfile.id, { password: new_password })
    if (legacySyncErr) {
      console.error('security-reset: failed to sync password to legacy Supabase Auth user', legacySyncErr)
    }
  } catch (legacySyncErr) {
    console.error('security-reset: failed to sync password to legacy Supabase Auth user', legacySyncErr)
  }

  return await respondPadded({ success: true }, 200, startedAt)
}
