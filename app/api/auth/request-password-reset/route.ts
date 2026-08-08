import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

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

  const { email } = body as { email?: unknown }

  if (typeof email !== 'string') return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  if (!email) return NextResponse.json({ error: 'Email is required.' }, { status: 400 })

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Look up the profile by email
  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .single()

  if (profileErr || !profile) {
    // Return generic success to avoid leaking whether an email exists
    return NextResponse.json({ success: true })
  }

  // Block duplicate pending requests
  const { data: existing } = await adminClient
    .from('password_reset_requests')
    .select('id')
    .eq('profile_id', profile.id)
    .eq('status', 'pending')
    .single()

  if (existing) {
    return NextResponse.json({ error: 'A reset request is already pending for this account. Please contact your admin.' }, { status: 409 })
  }

  await adminClient.from('password_reset_requests').insert({ profile_id: profile.id })

  return NextResponse.json({ success: true })
}
