import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import DashboardContent, { DashboardStat } from '@/components/dashboard/DashboardContent'
import { Phone, FileText, Users, AlertTriangle } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: profile },
    { data: callbacks },
    { data: followups },
    { data: customers },
    { data: notifications },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user!.id).single(),
    supabase.from('callbacks').select('*, customers(name, phone)').eq('agent_id', user!.id).order('scheduled_at', { ascending: true }),
    supabase.from('followups').select('*, customers(name, phone)').eq('agent_id', user!.id).order('created_at', { ascending: false }),
    supabase.from('customers').select('id').eq('created_by', user!.id),
    supabase.from('notifications').select('id').eq('recipient_id', user!.id).eq('read', false),
  ])

  const pendingCallbacks = callbacks?.filter(c => c.status === 'pending') || []
  const openFollowups = followups?.filter(f => ['open', 'in_progress'].includes(f.status)) || []
  const urgentFollowups = followups?.filter(f => f.priority === 'urgent' && f.status !== 'resolved') || []

  const stats: DashboardStat[] = [
    { label: 'My Customers', value: customers?.length || 0, icon: Users, color: 'bg-blue-500', href: '/customers' },
    { label: 'Pending Callbacks', value: pendingCallbacks.length, icon: Phone, color: 'bg-amber-500', href: '/callbacks' },
    { label: 'Open Follow-ups', value: openFollowups.length, icon: FileText, color: 'bg-indigo-500', href: '/followups' },
    { label: 'Unread Alerts', value: notifications?.length || 0, icon: AlertTriangle, color: 'bg-red-500', href: '#' },
  ]

  return (
    <div>
      <Header title={`Welcome back, ${profile?.full_name?.split(' ')[0]}`} userId={user!.id} userRole={profile?.role} />
      <DashboardContent
        stats={stats}
        pendingCallbacks={pendingCallbacks}
        openFollowups={openFollowups}
        urgentFollowups={urgentFollowups}
      />
    </div>
  )
}
