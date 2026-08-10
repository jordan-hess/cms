'use client'

import { useEffect, useRef } from 'react'
import { RequestWithDetail } from '@/types'
import { Inbox, X } from 'lucide-react'
import TeamRequestsBody from './TeamRequestsBody'

interface Props {
  open: boolean
  onClose: () => void
  requests: RequestWithDetail[]
  currentUserId: string
  onRefresh: () => void
}

export default function TeamRequestsModal({ open, onClose, requests, currentUserId, onRefresh }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !panelRef.current) return
    import('animejs').then(({ animate }) => {
      animate(panelRef.current!, {
        scale: [0.97, 1],
        opacity: [0, 1],
        duration: 260,
        easing: 'easeOutQuart',
      })
      if (overlayRef.current) {
        animate(overlayRef.current, { opacity: [0, 1], duration: 200, easing: 'easeOutQuad' })
      }
    })
  }, [open])

  function handleClose() {
    if (!panelRef.current) { onClose(); return }
    import('animejs').then(({ animate }) => {
      animate(panelRef.current!, {
        scale: [1, 0.97],
        opacity: [1, 0],
        duration: 180,
        easing: 'easeInQuad',
        onComplete: () => onClose(),
      })
      if (overlayRef.current) {
        animate(overlayRef.current, { opacity: [1, 0], duration: 160, easing: 'easeInQuad' })
      }
    })
  }

  if (!open) return null

  const pendingCount = requests.filter(r => r.status === 'pending' || r.status === 'changes_requested').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        ref={overlayRef}
        style={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
      />

      <div
        ref={panelRef}
        style={{ opacity: 0 }}
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Team Requests</h2>
            {pendingCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                {pendingCount} pending
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <TeamRequestsBody requests={requests} currentUserId={currentUserId} onRefresh={onRefresh} />
      </div>
    </div>
  )
}
