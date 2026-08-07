import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { redirect } from 'next/navigation'
import Header from '@/components/layout/Header'
import RosterManager from '@/components/roster/RosterManager'
import { getRosterFetchRange } from '@/lib/roster/calendarUtils'
import { Team, TeamMember, RosterPageData, RequestWithDetail } from '@/types'

export default async function RosterPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  if (!userId) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (!profile) redirect('/login')

  const now = new Date()
  const { from, to } = getRosterFetchRange(now.getFullYear(), now.getMonth())

  const requestDetailSelect = `
    *,
    profiles!requests_profile_id_fkey(id, full_name, email),
    teams(id, name, color),
    leave_requests(*),
    overtime_requests(*, overtime_entries(*))
  `

  const [
    { data: teams },
    { data: allProfiles },
    { data: shiftTemplates },
    { data: rotations },
    { data: attendanceRecords },
    { data: overrides },
    { data: myRequests },
    { data: pendingRequests },
    { data: teamLeaderRows },
  ] = await Promise.all([
    supabase
      .from('teams')
      .select('*, team_members(id, team_id, profile_id, joined_at, profiles(id, full_name, email, is_active))')
      .order('name'),
    supabase
      .from('profiles')
      .select('id, full_name, email, is_active')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('shift_templates')
      .select('*')
      .order('name'),
    supabase
      .from('team_rotations')
      .select('*, teams(id, name, color), shift_templates(id, name, start_time, end_time, work_days)')
      .gte('week_start_date', from)
      .lte('week_start_date', to),
    supabase
      .from('attendance_records')
      .select('*')
      .gte('date', from)
      .lte('date', to),
    supabase
      .from('roster_overrides')
      .select('*, shift_templates(id, name, start_time, end_time)')
      .gte('date', from)
      .lte('date', to),
    // Current user's own requests
    supabase
      .from('requests')
      .select(requestDetailSelect)
      .eq('profile_id', userId)
      .order('created_at', { ascending: false }),
    // Admin: all pending requests (RLS returns empty for agents)
    profile.role === 'admin'
      ? supabase
          .from('requests')
          .select(requestDetailSelect)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    // Team leader team IDs for the current admin (empty for agents)
    profile.role === 'admin'
      ? supabase.from('team_leaders').select('team_id').eq('profile_id', userId)
      : Promise.resolve({ data: [] }),
  ])

  // Derive the current user's team from the team_members data
  const flatMembers: TeamMember[] = (teams ?? []).flatMap((t: Team & { team_members: TeamMember[] }) => t.team_members ?? [])
  const myMembership = flatMembers.find(m => m.profile_id === userId)
  const userTeam = myMembership
    ? (teams ?? []).find((t: Team & { team_members: TeamMember[] }) => t.id === myMembership.team_id) ?? null
    : null

  const teamLeaderTeamIds = (teamLeaderRows ?? []).map((r: { team_id: string }) => r.team_id)

  const pageData: RosterPageData = {
    profile,
    teams: (teams ?? []) as (Team & { team_members: TeamMember[] })[],
    allProfiles: allProfiles ?? [],
    shiftTemplates: shiftTemplates ?? [],
    rotations: rotations ?? [],
    attendanceRecords: attendanceRecords ?? [],
    overrides: overrides ?? [],
    userTeam,
    myRequests: (myRequests ?? []) as RequestWithDetail[],
    pendingRequests: (pendingRequests ?? []) as RequestWithDetail[],
    teamLeaderTeamIds,
  }

  return (
    <div className="flex-1 overflow-auto">
      <Header title="Team Roster" userId={profile.id} userRole={profile.role} />
      <div className="p-6 space-y-5">
        <RosterManager data={pageData} />
      </div>
    </div>
  )
}
