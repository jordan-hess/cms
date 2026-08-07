import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { hashPassword } from '@/lib/auth/password'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { full_name, email, password, clear_force_password_change } = await request.json()

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

  return NextResponse.json({ success: true })
}
