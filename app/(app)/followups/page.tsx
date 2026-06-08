import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import FollowupManager from '@/components/followups/FollowupManager'

export default async function FollowupsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user!.id).single()

  const followupQuery = supabase
    .from('followups')
    .select('*, customers(name, phone), profiles!followups_agent_id_fkey(full_name), creator:profiles!followups_created_by_fkey(full_name)')
    .order('created_at', { ascending: false })

  if (profile?.role !== 'admin') followupQuery.eq('agent_id', user!.id)

  const { data: followups } = await followupQuery

  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, phone')
    .order('name', { ascending: true })

  return (
    <div>
      <Header title="Follow-ups & Escalations" userId={user!.id} userRole={profile?.role} />
      <div className="p-6">
        <FollowupManager followups={followups || []} customers={customers || []} userId={user!.id} isAdmin={profile?.role === 'admin'} />
      </div>
    </div>
  )
}
