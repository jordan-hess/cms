import { createClient as createAdminClient } from '@supabase/supabase-js'
import { hashPassword } from '@/lib/auth/password'
import { NextResponse } from 'next/server'

const SECURITY_ANSWER = 'let it rain'

export async function POST(request: Request) {
  const { email, answer, new_password } = await request.json()

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
    .eq('email', email.toLowerCase().trim())
    .single()

  if (findErr || !profile) {
    return NextResponse.json({ error: 'No account found with that email address.' }, { status: 404 })
  }

  const password_hash = await hashPassword(new_password)

  const { error: updateErr } = await adminClient
    .from('profiles')
    .update({ password_hash, force_password_change: false })
    .eq('id', profile.id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
