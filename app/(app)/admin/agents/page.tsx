import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import AgentManager from '@/components/admin/AgentManager'

export default async function AdminAgentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: agents } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div>
      <Header title="Manage Agents" userId={user!.id} />
      <div className="p-6">
        <AgentManager agents={agents || []} adminId={user!.id} />
      </div>
    </div>
  )
}
