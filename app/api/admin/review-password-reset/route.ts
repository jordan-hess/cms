import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pw = 'Tmp@'
  for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)]
  return pw
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: reviewer } = await supabase.from('profiles').select('role').eq('id', user.id).single()
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

  // Fetch the reset request with the profile's auth user id
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
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', request_id)
    return NextResponse.json({ success: true })
  }

  // Approve: generate temp password, update auth user, set force_password_change
  const tempPassword = generateTempPassword()

  // Find the auth user id (profile id = auth user id in Supabase)
  const { error: pwErr } = await adminClient.auth.admin.updateUserById(resetReq.profile_id, {
    password: tempPassword,
  })
  if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })

  await adminClient.from('profiles').update({ force_password_change: true }).eq('id', resetReq.profile_id)

  await adminClient.from('password_reset_requests').update({
    status: 'approved',
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', request_id)

  return NextResponse.json({ success: true, temp_password: tempPassword })
}
