import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { hashPassword } from '@/lib/auth/password'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single()
  if (profile?.role !== 'admin' && profile?.role !== 'management') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { email, full_name, password, role, department } = body as {
    email?: string; full_name?: string; password?: string; role?: string; department?: string
  }
  if (!email || !full_name || !password || !role) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const normalizedEmail = email.toLowerCase().trim()
  const { data: existing } = await adminSupabase.from('profiles').select('id').eq('email', normalizedEmail).single()
  if (existing) return NextResponse.json({ error: 'A user with that email already exists.' }, { status: 409 })

  const password_hash = await hashPassword(password)

  const { error } = await adminSupabase.from('profiles').insert({
    id: randomUUID(),
    email: normalizedEmail,
    full_name,
    role,
    department: department ?? null,
    password_hash,
    is_active: true,
  })

  if (error) {
    console.error('create-user: failed to insert profile', error)
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
