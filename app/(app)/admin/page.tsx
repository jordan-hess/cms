import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import { Users, Phone, FileText, AlertTriangle, CheckCircle, TrendingUp, Inbox } from 'lucide-react'
import Link from 'next/link'
import PasswordResetPanel from '@/components/admin/PasswordResetPanel'

export default async function AdminDashboardPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  const [
    { data: agents },
    { data: allCallbacks },
    { data: allFollowups },
    { data: allCustomers },
    { data: teamLeaderRows },
    { data: allPendingRequests },
    { data: resetRequests },
  ] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, role, department, avatar_url, is_active, force_password_change, created_at, updated_at').eq('role', 'agent').eq('is_active', true),
    supabase.from('callbacks').select('*, customers(name, phone), profiles!callbacks_agent_id_fkey(full_name)').order('scheduled_at', { ascending: true }),
    supabase.from('followups').select('*, customers(name, phone), profiles!followups_agent_id_fkey(full_name)').order('created_at', { ascending: false }),
    supabase.from('customers').select('id'),
    supabase.from('team_leaders').select('team_id').eq('profile_id', userId!),
    supabase.from('requests').select('id, status, type, team_id').eq('status', 'pending'),
    // profiles!password_reset_requests_profile_id_fkey disambiguates the embed:
    // this table has two FKs to profiles (profile_id, reviewed_by), so an
    // unqualified `profiles(...)` makes PostgREST return a 300 "Could not embed
    // because more than one relationship was found" error instead of rows.
    // Same bug, same fix, as app/(app)/admin/requests/page.tsx's identical query
    // (Task 12 QA fix round 1) — this copy on the Admin Dashboard was missed
    // during the first pass because that pass only exercised /admin/requests.
    supabase.from('password_reset_requests').select('*, profiles!password_reset_requests_profile_id_fkey(full_name, email)').eq('status', 'pending').order('created_at', { ascending: true }),
  ])

  const pendingCallbacks = allCallbacks?.filter(c => c.status === 'pending') || []
  const openFollowups = allFollowups?.filter(f => ['open', 'in_progress'].includes(f.status)) || []
  const escalations = allFollowups?.filter(f => f.type === 'escalation') || []
  const urgentItems = allFollowups?.filter(f => f.priority === 'urgent' && f.status !== 'resolved') || []

  // Team requests metric — scoped to leader's teams if applicable
  const teamLeaderTeamIds = (teamLeaderRows ?? []).map(r => r.team_id)
  const isTeamLeader = teamLeaderTeamIds.length > 0
  const pendingTeamRequests = isTeamLeader
    ? (allPendingRequests ?? []).filter(r => r.team_id && teamLeaderTeamIds.includes(r.team_id))
    : (allPendingRequests ?? [])

  const stats = [
    { label: 'Active Agents', value: agents?.length || 0, icon: Users, color: 'bg-blue-500', href: '/admin/agents' },
    { label: 'Total Customers', value: allCustomers?.length || 0, icon: TrendingUp, color: 'bg-green-500', href: '#' },
    { label: 'Pending Callbacks', value: pendingCallbacks.length, icon: Phone, color: 'bg-amber-500', href: '#' },
    { label: 'Open Follow-ups', value: openFollowups.length, icon: FileText, color: 'bg-indigo-500', href: '#' },
    { label: 'Escalations', value: escalations.length, icon: AlertTriangle, color: 'bg-red-500', href: '/admin/escalations' },
    { label: 'Urgent Items', value: urgentItems.length, icon: AlertTriangle, color: 'bg-rose-600', href: '/admin/escalations' },
    { label: isTeamLeader ? 'My Team Requests' : 'Team Requests', value: pendingTeamRequests.length, icon: Inbox, color: 'bg-purple-500', href: '/admin/requests' },
  ]

  return (
    <div>
      <Header title="Admin Dashboard" userId={userId!} userRole="admin" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(({ label, value, icon: Icon, color, href }, index) => (
            <Link
              key={label}
              href={href}
              className={`bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow ${
                index === 6 ? 'col-span-2 lg:col-span-1' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`${color} rounded-lg p-2`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{value}</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">{label}</p>
            </Link>
          ))}
        </div>

        {/* All agents workload */}
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-white">Agent Workload</h2>
            <Link href="/admin/agents" className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">Manage agents</Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {agents?.map(agent => {
              const agentCallbacks = pendingCallbacks.filter(c => c.agent_id === agent.id).length
              const agentFollowups = openFollowups.filter(f => f.agent_id === agent.id).length
              const agentEscalations = escalations.filter(f => f.agent_id === agent.id && ['open', 'in_progress'].includes(f.status)).length
              return (
                <div key={agent.id} className="px-5 py-3 flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-sm font-semibold text-white shrink-0">
                    {agent.full_name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{agent.full_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{agent.email}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1 text-amber-600">
                      <Phone className="w-3 h-3" />{agentCallbacks}
                    </span>
                    <span className="flex items-center gap-1 text-indigo-600">
                      <FileText className="w-3 h-3" />{agentFollowups}
                    </span>
                    {agentEscalations > 0 && (
                      <span className="flex items-center gap-1 text-red-600">
                        <AlertTriangle className="w-3 h-3" />{agentEscalations}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Password reset requests */}
        <PasswordResetPanel requests={resetRequests || []} />

        {/* Recent escalations */}
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Recent Escalations
            </h2>
            <Link href="/admin/escalations" className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">Send escalation</Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {escalations.slice(0, 6).length === 0 ? (
              <div className="px-5 py-8 text-center">
                <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No escalations</p>
              </div>
            ) : escalations.slice(0, 6).map(esc => (
              <div key={esc.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{(esc.customers as any)?.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Assigned to: {(esc.profiles as any)?.full_name}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-1">{esc.query_description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      esc.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                      esc.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{esc.priority}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      esc.status === 'resolved' ? 'bg-green-100 text-green-700' :
                      esc.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>{esc.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
