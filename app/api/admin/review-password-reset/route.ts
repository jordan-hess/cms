import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { hashPassword } from '@/lib/auth/password'
import { NextResponse } from 'next/server'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pw = 'Tmp@'
  for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)]
  return pw
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: reviewer } = await supabase.from('profiles').select('role').eq('id', userId).single()
  if (reviewer?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { request_id, action } = await request.json()
  if (!request_id || !['approve', 'reject'].includes(action)) {
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

  if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })

  await adminClient.from('password_reset_requests').update({
    status: 'approved',
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
  }).eq('id', request_id)

  return NextResponse.json({ success: true, temp_password: tempPassword })
}
