import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Header from '@/components/layout/Header'
import RosterManager from '@/components/roster/RosterManager'
import { getRosterFetchRange } from '@/lib/roster/calendarUtils'
import { Team, TeamMember, RosterPageData } from '@/types'

export default async function RosterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const now = new Date()
  const { from, to } = getRosterFetchRange(now.getFullYear(), now.getMonth())

  const [
    { data: teams },
    { data: allProfiles },
    { data: shiftTemplates },
    { data: rotations },
    { data: attendanceRecords },
    { data: overrides },
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
  ])

  // Derive the current user's team from the team_members data
  const flatMembers: TeamMember[] = (teams ?? []).flatMap((t: Team & { team_members: TeamMember[] }) => t.team_members ?? [])
  const myMembership = flatMembers.find(m => m.profile_id === user.id)
  const userTeam = myMembership
    ? (teams ?? []).find((t: Team & { team_members: TeamMember[] }) => t.id === myMembership.team_id) ?? null
    : null

  const pageData: RosterPageData = {
    profile,
    teams: (teams ?? []) as (Team & { team_members: TeamMember[] })[],
    allProfiles: allProfiles ?? [],
    shiftTemplates: shiftTemplates ?? [],
    rotations: rotations ?? [],
    attendanceRecords: attendanceRecords ?? [],
    overrides: overrides ?? [],
    userTeam,
  }

  return (
    <div className="flex-1 overflow-auto">
      <Header title="Team Roster" userId={profile.id} />
      <div className="p-6 space-y-5">
        <RosterManager data={pageData} />
      </div>
    </div>
  )
}
