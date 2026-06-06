import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Header from '@/components/layout/Header'
import AdminRequestsWrapper from '@/components/requests/admin/AdminRequestsWrapper'
import { RequestWithDetail } from '@/types'

const REQUEST_DETAIL_SELECT = `
  *,
  profiles!requests_profile_id_fkey(id, full_name, email),
  teams(id, name, color),
  leave_requests(*),
  overtime_requests(*, overtime_entries(*))
`

export default async function AdminRequestsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { data: requestsData },
    { data: teamLeaderRows },
  ] = await Promise.all([
    supabase
      .from('requests')
      .select(REQUEST_DETAIL_SELECT)
      .order('created_at', { ascending: false }),
    supabase
      .from('team_leaders')
      .select('team_id')
      .eq('profile_id', user.id),
  ])

  const teamLeaderTeamIds = (teamLeaderRows ?? []).map(r => r.team_id)
  const isTeamLeader = teamLeaderTeamIds.length > 0

  // Team leaders see only requests for their teams; regular admins see all
  const requests = ((requestsData ?? []) as RequestWithDetail[]).filter(r => {
    if (!isTeamLeader) return true
    return r.team_id ? teamLeaderTeamIds.includes(r.team_id) : false
  })

  const pendingCount = requests.filter(r => r.status === 'pending').length

  return (
    <div className="flex-1 overflow-auto">
      <Header
        title={`Requests${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}`}
        userId={user.id}
      />
      <div className="p-6">
        <AdminRequestsWrapper requests={requests} currentUserId={user.id} />
      </div>
    </div>
  )
}
