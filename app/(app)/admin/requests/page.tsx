'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import RequestsAdminPanel from '@/components/requests/admin/RequestsAdminPanel'
import { RequestWithDetail } from '@/types'
import { Loader2 } from 'lucide-react'

const REQUEST_DETAIL_SELECT = `
  *,
  profiles!requests_profile_id_fkey(id, full_name, email),
  teams(id, name, color),
  leave_requests(*),
  overtime_requests(*, overtime_entries(*))
`

export default function AdminRequestsPage() {
  const router = useRouter()
  const [requests, setRequests] = useState<RequestWithDetail[]>([])
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(true)

  async function fetchRequests() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    setUserId(user.id)

    const { data } = await supabase
      .from('requests')
      .select(REQUEST_DETAIL_SELECT)
      .order('created_at', { ascending: false })

    setRequests((data ?? []) as RequestWithDetail[])
    setLoading(false)
  }

  useEffect(() => { fetchRequests() }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  const pendingCount = requests.filter(r => r.status === 'pending').length

  return (
    <div className="flex-1 overflow-auto">
      <Header title={`Requests${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}`} userId={userId} />
      <div className="p-6">
        <RequestsAdminPanel
          requests={requests}
          currentUserId={userId}
          onRefresh={fetchRequests}
        />
      </div>
    </div>
  )
}
