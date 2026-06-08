'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Notification } from '@/types'
import { formatDistanceToNow } from 'date-fns'

interface HeaderProps {
  title: string
  userId: string
  userRole?: string
}

export default function Header({ title, userId, userRole }: HeaderProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const supabase = createClient()

  async function fetchNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*, sender:sender_id(full_name)')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifications((data as Notification[]) || [])
  }

  async function markAllRead() {
    await supabase
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('recipient_id', userId)
      .eq('read', false)
    fetchNotifications()
  }

  async function markRead(id: string) {
    await supabase
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  function getDestination(type: string): string | null {
    switch (type) {
      case 'callback':
      case 'reminder':
        return '/callbacks'
      case 'escalation':
      case 'followup':
        return '/followups'
      case 'request':
        return userRole === 'admin' ? '/admin/requests' : '/roster'
      default:
        return null
    }
  }

  async function handleClick(n: Notification) {
    if (!n.read) await markRead(n.id)
    const dest = getDestination(n.type)
    if (dest) {
      setOpen(false)
      router.push(dest)
    }
  }

  useEffect(() => {
    fetchNotifications()
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `recipient_id=eq.${userId}`,
      }, () => fetchNotifications())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  const unreadCount = notifications.filter(n => !n.read).length

  const badgeColor: Record<string, string> = {
    escalation: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
    followup:   'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
    reminder:   'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
    callback:   'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
    request:    'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400',
    info:       'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  }

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 h-20 px-6 flex items-center justify-between">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h1>

      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="relative p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 mt-2 w-96 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 z-20 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <span className="font-semibold text-gray-900 dark:text-white text-sm">Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-xs text-blue-600 hover:text-blue-400">
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
                {notifications.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No notifications</p>
                ) : (
                  notifications.map(n => {
                    const navigable = !!getDestination(n.type)
                    return (
                      <div
                        key={n.id}
                        onClick={() => handleClick(n)}
                        className={`px-4 py-3 transition-colors ${!n.read ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''} ${navigable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800' : 'cursor-default'}`}
                      >
                        <div className="flex items-start gap-3">
                          {!n.read && <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 shrink-0" />}
                          <div className={`flex-1 ${!n.read ? '' : 'ml-5'}`}>
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-medium text-gray-900 dark:text-white">{n.title}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badgeColor[n.type] || badgeColor.info}`}>
                                {n.type}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">{n.message}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                              {n.sender && ` · from ${(n.sender as { full_name: string }).full_name}`}
                              {navigable && <span className="ml-1 text-blue-500 dark:text-blue-400">→ View</span>}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
