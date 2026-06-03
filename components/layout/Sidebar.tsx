'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, Phone, FileText, ShieldAlert, LogOut, UserCog, CalendarDays, Settings, Inbox,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Profile } from '@/types'
import ThemeToggle from '@/components/ui/ThemeToggle'

interface SidebarProps {
  profile: Profile
}

const agentLinks = [
  { href: '/dashboard', label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/customers', label: 'Customers',   icon: Users           },
  { href: '/callbacks', label: 'Callbacks',   icon: Phone           },
  { href: '/followups', label: 'Follow-ups',  icon: FileText        },
  { href: '/roster',    label: 'Team Roster', icon: CalendarDays    },
]

const adminLinks = [
  { href: '/admin', label: 'Admin Dashboard', icon: ShieldAlert },
  { href: '/admin/agents', label: 'Manage Agents', icon: UserCog },
  { href: '/admin/escalations', label: 'Escalations', icon: FileText },
  { href: '/admin/requests', label: 'Requests', icon: Inbox },
]

export default function Sidebar({ profile }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex flex-col h-full w-64 bg-gray-900 text-white">
      <div className="flex items-center gap-3 px-6 h-20 border-b border-gray-800">
        <img
          src="/logo.png"
          alt="Social CMS logo"
          className="w-8 h-8 rounded-lg object-cover"
        />
        <div>
          <p className="font-semibold text-sm">Social CMS</p>
          <p className="text-xs text-gray-400 capitalize">{profile.role}</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {agentLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname === href
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}

        {profile.role === 'admin' && (
          <>
            <div className="pt-4 pb-2 px-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Admin</p>
            </div>
            {adminLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  pathname === href || pathname.startsWith(href + '/')
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </>
        )}
      </nav>

      <div className="px-3 pb-2 border-t border-gray-700">
        <div className="pt-3 pb-1 px-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <Settings className="w-3 h-3" /> Preferences
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="px-3 py-4 border-t border-gray-700">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-sm font-semibold">
            {profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{profile.full_name}</p>
            <p className="text-xs text-gray-400 truncate">{profile.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  )
}
