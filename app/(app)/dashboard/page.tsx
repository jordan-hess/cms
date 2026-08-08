import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import DashboardContent, { DashboardStat } from '@/components/dashboard/DashboardContent'
import ConsoleDesktop from '@/components/console/ConsoleDesktop'
import { formatDateKey, getISOWeekStart } from '@/lib/roster/calendarUtils'

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
    if (profile.role === 'management') {
      const now = new Date()
      const todayIso = formatDateKey(now)
      const weekStart = formatDateKey(getISOWeekStart(now))

      const [
        { data: agents },
        { data: teamMembers },
        { data: teamRotations },
        { data: attendanceRecords },
        { data: rosterOverrides },
        { data: teamLeaders },
      ] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('role', 'agent').eq('is_active', true),
        supabase.from('team_members').select('id, team_id, profile_id, joined_at'),
        supabase.from('team_rotations').select('*, shift_templates(*)').eq('week_start_date', weekStart),
        supabase.from('attendance_records').select('*').eq('date', todayIso),
        supabase.from('roster_overrides').select('*, shift_templates(*)').eq('date', todayIso),
        supabase.from('team_leaders').select('id, profile_id, profiles!team_leaders_profile_id_fkey(id, full_name, is_active)'),
      ])

      const leaders = (teamLeaders || [])
        .map((tl: any) => tl.profiles)
        .filter((p: any) => p != null && p.is_active)
        .map((p: any) => ({ id: p.id, full_name: p.full_name }))

      managementData = {
        agents: agents || [],
        teamMembers: teamMembers || [],
        teamRotations: teamRotations || [],
        attendanceRecords: attendanceRecords || [],
        rosterOverrides: rosterOverrides || [],
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
