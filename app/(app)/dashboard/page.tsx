import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import { Phone, FileText, Users, CheckCircle, Clock, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

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

  const stats = [
    { label: 'My Customers', value: customers?.length || 0, icon: Users, color: 'bg-blue-500', href: '/customers' },
    { label: 'Pending Callbacks', value: pendingCallbacks.length, icon: Phone, color: 'bg-amber-500', href: '/callbacks' },
    { label: 'Open Follow-ups', value: openFollowups.length, icon: FileText, color: 'bg-indigo-500', href: '/followups' },
    { label: 'Unread Alerts', value: notifications?.length || 0, icon: AlertTriangle, color: 'bg-red-500', href: '#' },
  ]

  return (
    <div>
      <Header title={`Welcome back, ${profile?.full_name?.split(' ')[0]}`} userId={user!.id} />

      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(({ label, value, icon: Icon, color, href }) => (
            <Link key={label} href={href} className="bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming Callbacks */}
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Phone className="w-4 h-4 text-amber-500" />
                Upcoming Callbacks
              </h2>
              <Link href="/callbacks" className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">View all</Link>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {pendingCallbacks.slice(0, 5).length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No pending callbacks</p>
                </div>
              ) : (
                pendingCallbacks.slice(0, 5).map(cb => (
                  <div key={cb.id} className="px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{(cb.customers as any)?.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{(cb.customers as any)?.phone}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-1">{cb.query_description}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Clock className="w-3.5 h-3.5 text-amber-500 ml-auto mb-0.5" />
                        <p className="text-xs text-gray-500 dark:text-gray-400">{formatDistanceToNow(new Date(cb.scheduled_at), { addSuffix: true })}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Open Follow-ups */}
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-500" />
                Open Follow-ups
              </h2>
              <Link href="/followups" className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">View all</Link>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {openFollowups.slice(0, 5).length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No open follow-ups</p>
                </div>
              ) : (
                openFollowups.slice(0, 5).map(fu => (
                  <div key={fu.id} className="px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{(fu.customers as any)?.name}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            fu.type === 'escalation' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                          }`}>{fu.type}</span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1">{fu.query_description}</p>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                        fu.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                        fu.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{fu.priority}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {urgentFollowups.length > 0 && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
              <h3 className="font-semibold text-red-800 dark:text-red-300 text-sm">Urgent Items Requiring Attention</h3>
            </div>
            <div className="space-y-1">
              {urgentFollowups.map(fu => (
                <p key={fu.id} className="text-sm text-red-700 dark:text-red-400">
                  {(fu.customers as any)?.name} — {fu.query_description}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
