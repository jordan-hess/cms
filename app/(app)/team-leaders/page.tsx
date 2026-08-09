import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import TeamLeadersBoard from '@/components/team-leaders/TeamLeadersBoard'

export default async function TeamLeadersPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  const [
    { data: teams },
    { data: teamMembers },
    { data: teamLeaders },
    { data: allProfiles },
  ] = await Promise.all([
    supabase.from('teams').select('*').order('name'),
    // Flat fetch, no embed — joined client-side against allProfiles below,
    // matching this codebase's established pattern for admin-style pages
    // (AgentManager, ManageTeamsModal) rather than an embedded select.
    supabase.from('team_members').select('*'),
    supabase.from('team_leaders').select('*'),
    // Fetch everyone, not just active people — inactive members/leaders still
    // need to resolve and render (greyed out) in their team column. The Add
    // flow filters to is_active itself when computing the unassigned pool.
    supabase.from('profiles').select('id, full_name, email, role, department, is_active'),
  ])

  return (
    <div>
      <Header title="Team Management" userId={userId!} />
      <div className="p-6">
        <TeamLeadersBoard
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
