'use client'

import { useRouter } from 'next/navigation'
import RequestsAdminPanel from './RequestsAdminPanel'
import { RequestWithDetail } from '@/types'

interface Props {
  requests: RequestWithDetail[]
  currentUserId: string
}

export default function AdminRequestsWrapper({ requests, currentUserId }: Props) {
  const router = useRouter()
  return (
    <RequestsAdminPanel
      requests={requests}
      currentUserId={currentUserId}
      onRefresh={() => router.refresh()}
    />
  )
}
