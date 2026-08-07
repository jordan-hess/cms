import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { hashPassword } from '@/lib/auth/password'
import { NextResponse } from 'next/server'
import { randomInt } from 'crypto'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pw = 'Tmp@'
  for (let i = 0; i < 8; i++) pw += chars[randomInt(chars.length)]
  return pw
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: reviewer } = await supabase.from('profiles').select('role').eq('id', userId).single()
  if (reviewer?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { request_id, action } = body as { request_id?: unknown; action?: unknown }
  if (typeof request_id !== 'string' || !['approve', 'reject'].includes(action as string)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: resetReq, error: fetchErr } = await adminClient
    .from('password_reset_requests')
    .select('id, profile_id, status')
    .eq('id', request_id)
    .single()

  if (fetchErr || !resetReq) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
  if (resetReq.status !== 'pending') return NextResponse.json({ error: 'Request is no longer pending.' }, { status: 409 })

  if (action === 'reject') {
    await adminClient.from('password_reset_requests').update({
      status: 'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', request_id)
    return NextResponse.json({ success: true })
  }

  const tempPassword = generateTempPassword()
  const password_hash = await hashPassword(tempPassword)

  const { error: pwErr } = await adminClient
    .from('profiles')
    .update({ password_hash, force_password_change: true })
    .eq('id', resetReq.profile_id)

  if (pwErr) {
    console.error('review-password-reset: failed to update profiles.password_hash', pwErr)
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }

  // Best-effort sync of the same password into the legacy Supabase Auth
  // credential so the account can't still be logged into via /login/legacy
  // with the old (compromised) password during the dual-login grace window.
  // Not every profile has a corresponding auth.users row (e.g. users created
  // after the FK-drop migration), so a failure here must not fail the request.
  try {
    const { error: legacySyncErr } = await adminClient.auth.admin.updateUserById(resetReq.profile_id, { password: tempPassword })
    if (legacySyncErr) {
      console.error('review-password-reset: failed to sync password to legacy Supabase Auth user', legacySyncErr)
    }
  } catch (legacySyncErr) {
    console.error('review-password-reset: failed to sync password to legacy Supabase Auth user', legacySyncErr)
  }

  await adminClient.from('password_reset_requests').update({
    status: 'approved',
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
  }).eq('id', request_id)

  return NextResponse.json({ success: true, temp_password: tempPassword })
}
