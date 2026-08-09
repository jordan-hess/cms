import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import TeamLeadersBoard from '@/components/team-leaders/TeamLeadersBoard'

export default async function AdminAgentsPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  const [
    { data: teams },
    { data: teamMembers },
    { data: teamLeaders },
    { data: allProfiles },
    { data: shiftTemplates },
  ] = await Promise.all([
    supabase.from('teams').select('*').order('name'),
    supabase.from('team_members').select('*'),
    supabase.from('team_leaders').select('*'),
    supabase.from('profiles').select('id, full_name, email, role, department, is_active'),
    supabase.from('shift_templates').select('*').order('name'),
  ])

  return (
    <div>
      <Header title="Manage Agents" userId={userId!} userRole="admin" />
      <div className="p-6">
        <TeamLeadersBoard
          isAdminView
          shiftTemplates={shiftTemplates || []}
          teams={teams || []}
          teamMembers={teamMembers || []}
          teamLeaders={teamLeaders || []}
          allProfiles={allProfiles || []}
          currentUserId={userId!}
        />
      </div>
    </div>
  )
}
