import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import DashboardContent, { DashboardStat } from '@/components/dashboard/DashboardContent'
import ConsoleDesktop from '@/components/console/ConsoleDesktop'

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
    supabase.from('profiles').select('*').eq('id', userId!).single(),
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
    return (
      <div className="h-full">
        <ConsoleDesktop
          role={profile.role}
          dashboardData={{ stats, pendingCallbacks, openFollowups, urgentFollowups }}
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
