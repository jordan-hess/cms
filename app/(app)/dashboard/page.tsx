import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import DashboardContent, { DashboardStat } from '@/components/dashboard/DashboardContent'
import ConsoleDesktop from '@/components/console/ConsoleDesktop'
import { formatDateKey, getISOWeekStart, getBusinessToday } from '@/lib/roster/calendarUtils'
import { AttendanceRecord, RosterOverride, TeamLeaderConsoleData } from '@/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  const [
    { data: profile },
    { data: callbacks },
    { data: followups },
    { data: customers },
    { data: notifications },
  ] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, role, department, avatar_url, is_active, force_password_change, created_at, updated_at').eq('id', userId!).single(),
    supabase.from('callbacks').select('*, customers(name, phone)').eq('agent_id', userId!).order('scheduled_at', { ascending: true }),
    supabase.from('followups').select('*, customers(name, phone)').eq('agent_id', userId!).order('created_at', { ascending: false }),
    supabase.from('customers').select('id').eq('created_by', userId!),
    supabase.from('notifications').select('id').eq('recipient_id', userId!).eq('read', false),
  ])

  const pendingCallbacks = callbacks?.filter(c => c.status === 'pending') || []
  const openFollowups = followups?.filter(f => ['open', 'in_progress'].includes(f.status)) || []
  const urgentFollowups = followups?.filter(f => f.priority === 'urgent' && f.status !== 'resolved') || []

  const stats: DashboardStat[] = [
    { label: 'My Customers', value: customers?.length || 0, icon: 'users', color: 'bg-blue-500', href: '/customers' },
    { label: 'Pending Callbacks', value: pendingCallbacks.length, icon: 'phone', color: 'bg-amber-500', href: '/callbacks' },
    { label: 'Open Follow-ups', value: openFollowups.length, icon: 'file-text', color: 'bg-indigo-500', href: '/followups' },
    { label: 'Unread Alerts', value: notifications?.length || 0, icon: 'alert-triangle', color: 'bg-red-500', href: '#' },
  ]

  if (profile?.role === 'admin' || profile?.role === 'management') {
    let managementData
    let teamLeaderConsoles: TeamLeaderConsoleData[] = []
    if (profile.role === 'management') {
      const now = getBusinessToday()
      const todayIso = formatDateKey(now)
      const weekStart = formatDateKey(getISOWeekStart(now))

      const [
        { data: agents, error: agentsErr },
        { data: teamMembers, error: teamMembersErr },
        { data: teamRotations, error: teamRotationsErr },
        { data: attendanceRecords, error: attendanceRecordsErr },
        { data: rosterOverrides, error: rosterOverridesErr },
        { data: teamLeaders, error: teamLeadersErr },
      ] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('role', 'agent').eq('is_active', true).order('full_name'),
        supabase.from('team_members').select('id, team_id, profile_id, joined_at'),
        supabase.from('team_rotations').select('*, shift_templates(*)').eq('week_start_date', weekStart),
        supabase.from('attendance_records').select('id, profile_id, date, status').eq('date', todayIso),
        supabase.from('roster_overrides').select('id, profile_id, date, override_type, shift_templates(id, name, start_time, end_time)').eq('date', todayIso),
        supabase.from('team_leaders').select('id, profile_id, team_id, teams(id, name, color), profiles!team_leaders_profile_id_fkey(id, full_name, is_active)'),
      ])

      if (agentsErr) console.error('[dashboard] failed to fetch agents for Management console:', agentsErr)
      if (teamMembersErr) console.error('[dashboard] failed to fetch teamMembers for Management console:', teamMembersErr)
      if (teamRotationsErr) console.error('[dashboard] failed to fetch teamRotations for Management console:', teamRotationsErr)
      if (attendanceRecordsErr) console.error('[dashboard] failed to fetch attendanceRecords for Management console:', attendanceRecordsErr)
      if (rosterOverridesErr) console.error('[dashboard] failed to fetch rosterOverrides for Management console:', rosterOverridesErr)
      if (teamLeadersErr) console.error('[dashboard] failed to fetch teamLeaders for Management console:', teamLeadersErr)

      const leaders = Array.from(
        new Map(
          (teamLeaders || [])
            .map((tl: any) => tl.profiles)
            .filter((p: any) => p != null && p.is_active)
            .map((p: any) => [p.id, { id: p.id, full_name: p.full_name }]),
        ).values(),
      )
      leaders.sort((a, b) => a.full_name.localeCompare(b.full_name))

      // Per-team-leader dashboard console aggregates — reuses teamMembers/teamLeaders
      // already fetched above, adds 4 bulk queries scoped to every team's agents at once.
      const membersByTeam = new Map<string, string[]>()
      for (const tm of teamMembers || []) {
        const list = membersByTeam.get(tm.team_id) ?? []
        list.push(tm.profile_id)
        membersByTeam.set(tm.team_id, list)
      }
      const allAgentIds = [...new Set((teamMembers || []).map(tm => tm.profile_id))]

      const [
        { data: allCustomers, error: allCustomersErr },
        { data: allCallbacks, error: allCallbacksErr },
        { data: allFollowups, error: allFollowupsErr },
        { data: allNotifications, error: allNotificationsErr },
      ] = allAgentIds.length
        ? await Promise.all([
            supabase.from('customers').select('id, created_by').in('created_by', allAgentIds),
            supabase.from('callbacks').select('id, agent_id').eq('status', 'pending').in('agent_id', allAgentIds),
            supabase.from('followups').select('id, agent_id').in('status', ['open', 'in_progress']).in('agent_id', allAgentIds),
            supabase.from('notifications').select('id, recipient_id').eq('read', false).in('recipient_id', allAgentIds),
          ])
        : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }]

      if (allCustomersErr) console.error('[dashboard] failed to fetch customers for team leader consoles:', allCustomersErr)
      if (allCallbacksErr) console.error('[dashboard] failed to fetch callbacks for team leader consoles:', allCallbacksErr)
      if (allFollowupsErr) console.error('[dashboard] failed to fetch followups for team leader consoles:', allFollowupsErr)
      if (allNotificationsErr) console.error('[dashboard] failed to fetch notifications for team leader consoles:', allNotificationsErr)

      teamLeaderConsoles = (teamLeaders || [])
        .filter((tl: any) => tl.profiles?.is_active)
        .map((tl: any) => {
          const agentIds = membersByTeam.get(tl.team_id) ?? []
          const inTeam = (id: string) => agentIds.includes(id)
          return {
            teamId: tl.team_id,
            teamName: tl.teams?.name ?? 'Unknown Team',
            teamColor: tl.teams?.color ?? 'blue',
            leaderName: tl.profiles?.full_name ?? 'Unknown',
            totalCustomers: (allCustomers || []).filter((c: any) => inTeam(c.created_by)).length,
            pendingCallbacks: (allCallbacks || []).filter((c: any) => inTeam(c.agent_id)).length,
            openFollowups: (allFollowups || []).filter((f: any) => inTeam(f.agent_id)).length,
            unreadAlerts: (allNotifications || []).filter((n: any) => inTeam(n.recipient_id)).length,
          }
        })

      managementData = {
        agents: agents || [],
        teamMembers: teamMembers || [],
        teamRotations: teamRotations || [],
        // Narrowed selects above only fetch the columns this feature reads; cast back to
        // the shared roster types (whose extra fields — notes, marked_by, etc. — are
        // never accessed by ManagementConsole/resolveShift) rather than widening the select.
        attendanceRecords: (attendanceRecords || []) as AttendanceRecord[],
        rosterOverrides: (rosterOverrides || []) as unknown as RosterOverride[],
        leaders,
        todayIso,
      }
    }

    return (
      <div className="h-full">
        <ConsoleDesktop
          role={profile.role}
          dashboardData={{ stats, pendingCallbacks, openFollowups, urgentFollowups }}
          managementData={managementData}
          teamLeaderConsoles={teamLeaderConsoles}
        />
      </div>
    )
  }

  return (
    <div>
      <Header title={`Welcome back, ${profile?.full_name?.split(' ')[0]}`} userId={userId!} userRole={profile?.role} />
      <DashboardContent
        stats={stats}
        pendingCallbacks={pendingCallbacks}
        openFollowups={openFollowups}
        urgentFollowups={urgentFollowups}
      />
    </div>
  )
}
