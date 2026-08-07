import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm'

export default async function ChangePasswordPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  if (!userId) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .single()

  if (!profile?.email) redirect('/login')

  return <ChangePasswordForm email={profile.email} />
}
