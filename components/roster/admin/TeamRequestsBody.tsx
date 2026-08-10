'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RequestWithDetail, RequestStatus } from '@/types'
import { teamColorClasses } from '@/lib/roster/teamColors'
import { Calendar, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import RequestReviewDrawer from '@/components/requests/admin/RequestReviewDrawer'

const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: 'Annual',
  sick: 'Sick',
  family_responsibility: 'Family',
  unpaid: 'Unpaid',
  other: 'Other',
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Props {
  requests: RequestWithDetail[]
  currentUserId: string
  onRefresh: () => void
}

type Tab = 'leave' | 'overtime'

export default function TeamRequestsBody({ requests, currentUserId, onRefresh }: Props) {
  const tabContentRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const [activeTab, setActiveTab] = useState<Tab>('leave')
  const [actioning, setActioning] = useState<string | null>(null)
  const [confirmingReject, setConfirmingReject] = useState<string | null>(null)
  const [rejectComment, setRejectComment] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<RequestWithDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!tabContentRef.current) return
    import('animejs').then(({ animate }) => {
      animate(tabContentRef.current!, {
        opacity: [0, 1],
        translateX: [10, 0],
        duration: 180,
        easing: 'easeOutQuad',
      })
    })
  }, [activeTab])

  function handleTabChange(tab: Tab) {
    setActiveTab(tab)
    setConfirmingReject(null)
    setError('')
  }

  const pendingRequests = requests.filter(r => r.status === 'pending' || r.status === 'changes_requested')
  const leaveRequests = pendingRequests.filter(r => r.type === 'leave')
  const overtimeRequests = pendingRequests.filter(r => r.type === 'overtime')
  const displayed = activeTab === 'leave' ? leaveRequests : overtimeRequests

  async function insertApprovalHistory(requestId: string, fromStatus: RequestStatus, toStatus: RequestStatus, comment?: string) {
    const supabase = createClient()
    await supabase.from('request_approval_history').insert({
      request_id: requestId,
      changed_by: currentUserId,
      from_status: fromStatus,
      to_status: toStatus,
      comment: comment || null,
    })
  }

  function animateRowOut(requestId: string, then: () => void) {
    const rowEl = rowRefs.current[requestId]
    if (!rowEl) { then(); return }
    import('animejs').then(({ animate }) => {
      animate(rowEl, {
        opacity: [1, 0],
        translateX: [0, -20],
        duration: 240,
        easing: 'easeInQuad',
        onComplete: then,
      })
    })
  }

  async function handleQuickApprove(req: RequestWithDetail) {
    setActioning(req.id + '_approve')
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('requests')
      .update({
        status: 'approved',
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.id)

    if (err) {
      setActioning(null)
      setError(err.message)
      return
    }

    await insertApprovalHistory(req.id, req.status, 'approved')
    animateRowOut(req.id, () => { setActioning(null); onRefresh() })
  }

  async function handleConfirmReject(req: RequestWithDetail) {
    if (!rejectComment.trim()) {
      setError('A reason is required when rejecting.')
      return
    }
    setActioning(req.id + '_reject')
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('requests')
      .update({
        status: 'rejected',
        admin_comment: rejectComment.trim(),
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.id)

    if (err) {
      setActioning(null)
      setError(err.message)
      return
    }

    await insertApprovalHistory(req.id, req.status, 'rejected', rejectComment.trim())
    animateRowOut(req.id, () => {
      setActioning(null)
      setConfirmingReject(null)
      setRejectComment('')
      onRefresh()
    })
  }

  function openDrawer(req: RequestWithDetail) {
    setSelected(req)
    setDrawerOpen(true)
  }

  const statusMap: Record<RequestStatus, string> = {
    draft:             'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
    pending:           'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    approved:          'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    rejected:          'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    changes_requested: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  }
  const statusLabels: Record<RequestStatus, string> = {
    draft: 'Draft', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', changes_requested: 'Changes Req.',
  }

  return (
    <>
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          {([
            { id: 'leave' as Tab, label: 'Leave', icon: <Calendar className="w-3.5 h-3.5" />, count: leaveRequests.length },
            { id: 'overtime' as Tab, label: 'Overtime', icon: <Clock className="w-3.5 h-3.5" />, count: overtimeRequests.length },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ml-0.5 ${
                  activeTab === tab.id
                    ? 'bg-white/20 text-white'
                    : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto" ref={tabContentRef}>
        {error && (
          <div className="mx-6 mt-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {displayed.length === 0 ? (
          <div className="py-16 text-center px-6">
            {activeTab === 'leave'
              ? <Calendar className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              : <Clock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            }
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No {activeTab === 'leave' ? 'leave' : 'overtime'} requests pending.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {displayed.map(req => {
              const teamColors = req.teams ? teamColorClasses[req.teams.color] : null
              const initials = (req.profiles?.full_name ?? '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
              const leaveDetail = req.leave_requests?.[0]
              const otDetail = req.overtime_requests?.[0]
              const isConfirmingReject = confirmingReject === req.id
              const isActioning = actioning?.startsWith(req.id)

              return (
                <div
                  key={req.id}
                  ref={el => { rowRefs.current[req.id] = el }}
                  className="flex flex-col px-6 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 ${teamColors ? teamColors.bg : 'bg-gray-400'}`}>
                      {initials}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {req.profiles?.full_name ?? 'Unknown'}
                        </p>
                        {req.teams && (
                          <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${teamColors?.lightBg} ${teamColors?.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${teamColors?.dot}`} />
                            {req.teams.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {leaveDetail
                            ? `${LEAVE_TYPE_LABELS[leaveDetail.leave_type] ?? leaveDetail.leave_type} · ${leaveDetail.dates.length} day${leaveDetail.dates.length !== 1 ? 's' : ''}`
                            : otDetail
                              ? `${MONTH_NAMES[otDetail.month - 1]} ${otDetail.year}`
                              : ''}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(req.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMap[req.status]}`}>
                        {statusLabels[req.status]}
                      </span>

                      <button
                        onClick={() => handleQuickApprove(req)}
                        disabled={!!actioning}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:bg-green-400 rounded-lg transition-colors"
                      >
                        {actioning === req.id + '_approve'
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <CheckCircle className="w-3 h-3" />}
                        Approve
                      </button>

                      <button
                        onClick={() => {
                          setConfirmingReject(isConfirmingReject ? null : req.id)
                          setRejectComment('')
                          setError('')
                        }}
                        disabled={!!actioning}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-lg transition-colors"
                      >
                        {actioning === req.id + '_reject'
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <XCircle className="w-3 h-3" />}
                        Reject
                      </button>

                      <button
                        onClick={() => openDrawer(req)}
                        className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        Details
                      </button>
                    </div>
                  </div>

                  {isConfirmingReject && (
                    <div className="w-full mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Reason for rejection (required)..."
                          value={rejectComment}
                          onChange={e => setRejectComment(e.target.value)}
                          className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
                        />
                        <button
                          onClick={() => handleConfirmReject(req)}
                          disabled={isActioning || !rejectComment.trim()}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-lg transition-colors shrink-0"
                        >
                          {isActioning ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm Reject'}
                        </button>
                        <button
                          onClick={() => { setConfirmingReject(null); setRejectComment(''); setError('') }}
                          className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <RequestReviewDrawer
        request={selected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSuccess={() => { setDrawerOpen(false); onRefresh() }}
        currentUserId={currentUserId}
      />
    </>
  )
}
