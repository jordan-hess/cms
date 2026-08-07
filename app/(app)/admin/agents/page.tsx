import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import AgentManager from '@/components/admin/AgentManager'

export default async function AdminAgentsPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  const [{ data: agents }, { data: teams }, { data: memberships }, { data: shiftTemplates }, { data: teamLeaders }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('teams').select('*').order('name'),
    supabase.from('team_members').select('*'),
    supabase.from('shift_templates').select('*').order('name'),
    supabase.from('team_leaders').select('*'),
  ])

  return (
    <div>
      <Header title="Manage Agents" userId={userId!} userRole="admin" />
      <div className="p-6">
        <AgentManager
          agents={agents || []}
          adminId={userId!}
          teams={teams || []}
          memberships={memberships || []}
          shiftTemplates={shiftTemplates || []}
          teamLeaders={teamLeaders || []}
        />
      </div>
    </div>
  )
}
