import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { getCurrentPeriodMonth } from '@/lib/coaching/period'
import Header from '@/components/layout/Header'
import CoachingManager from '@/components/coaching/CoachingManager'

export default async function CoachingPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  const periodMonth = getCurrentPeriodMonth()

  const [
    { data: teamLeaders },
    { data: teamMembers },
    { data: agentCheckins },
    { data: leaderCheckins },
  ] = await Promise.all([
    // team_leaders has two FKs to profiles (profile_id, assigned_by) — the
    // embed must be qualified or PostgREST returns an error instead of rows
    // (see app/(app)/admin/requests/page.tsx for the same pattern/reason).
    supabase.from('team_leaders').select('*, profiles!team_leaders_profile_id_fkey(id, full_name, department), teams(id, name, color)'),
    supabase.from('team_members').select('*, profiles(id, full_name, is_active)'),
    supabase.from('coaching_agent_checkins').select('*').eq('period_month', periodMonth),
    supabase.from('coaching_leader_checkins').select('*').eq('period_month', periodMonth),
  ])

  return (
    <div>
      <Header title="Coaching" userId={userId!} />
      <div className="p-6">
        <CoachingManager
          teamLeaders={teamLeaders || []}
          teamMembers={teamMembers || []}
          agentCheckins={agentCheckins || []}
          leaderCheckins={leaderCheckins || []}
          periodMonth={periodMonth}
          userId={userId!}
        />
      </div>
    </div>
  )
}
