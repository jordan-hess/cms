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
    supabase.from('teams').select('id, name, color, description').order('name'),
    supabase.from('team_members').select('id, team_id, profile_id, joined_at, profiles(id, full_name, email, role, department, is_active)'),
    // team_leaders has two FKs to profiles (profile_id, assigned_by) — the embed
    // must be qualified or PostgREST returns an error instead of rows (see
    // app/(app)/coaching/page.tsx for the same pattern/reason).
    supabase.from('team_leaders').select('id, team_id, profile_id, assigned_by, created_at, profiles!team_leaders_profile_id_fkey(id, full_name, email, role, department, is_active)'),
    supabase.from('profiles').select('id, full_name, email, role, department, is_active').eq('is_active', true),
  ])

  return (
    <div>
      <Header title="Team Leaders Management" userId={userId!} />
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
