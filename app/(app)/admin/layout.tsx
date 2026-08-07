import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { redirect } from 'next/navigation'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId!).single()

  if (profile?.role !== 'admin') redirect('/dashboard')

  return <>{children}</>
}
