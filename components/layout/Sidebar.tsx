'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, Phone, FileText, ShieldAlert, LogOut, UserCog,
  CalendarDays, Settings, Inbox, Pencil, Eye, EyeOff, Check,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Profile } from '@/types'
import ThemeToggle from '@/components/ui/ThemeToggle'
import Modal from '@/components/ui/Modal'
import PatchNotesModal from '@/components/ui/PatchNotesModal'

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
  { href: '/admin',              label: 'Admin Dashboard', icon: ShieldAlert },
  { href: '/admin/agents',       label: 'Manage Agents',   icon: UserCog     },
  { href: '/admin/escalations',  label: 'Escalations',     icon: FileText    },
  { href: '/admin/requests',     label: 'Requests',        icon: Inbox       },
]

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function Sidebar({ profile }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const [modalOpen, setModalOpen] = useState(false)
  const [patchNotesOpen, setPatchNotesOpen] = useState(false)

  const [profileForm, setProfileForm] = useState({ full_name: profile.full_name, email: profile.email })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')

  const [pwForm, setPwForm] = useState({ password: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState('')
  const [showPw, setShowPw] = useState(false)

  function openModal() {
    setProfileForm({ full_name: profile.full_name, email: profile.email })
    setProfileError(''); setProfileSuccess('')
    setPwForm({ password: '', confirm: '' })
    setPwError(''); setPwSuccess('')
    setModalOpen(true)
  }

  async function handleLogout() {
    await signOut({ redirect: false })
    router.push('/login')
    router.refresh()
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfileSaving(true)
    setProfileError('')
    setProfileSuccess('')

    const updates: { full_name?: string; email?: string } = {}
    if (profileForm.full_name !== profile.full_name) updates.full_name = profileForm.full_name
    if (profileForm.email !== profile.email) updates.email = profileForm.email

    if (Object.keys(updates).length === 0) {
      setProfileSaving(false)
      setProfileSuccess('No changes to save.')
      return
    }

    if (updates.full_name) {
      const { error } = await supabase.from('profiles').update({ full_name: updates.full_name }).eq('id', profile.id)
      if (error) { setProfileError(error.message); setProfileSaving(false); return }
    }

    if (updates.email) {
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: updates.email }),
      })
      const data = await res.json()
      if (!res.ok) { setProfileError(data.error || 'Something went wrong.'); setProfileSaving(false); return }
      setProfileSuccess('Profile updated successfully.')
    } else {
      setProfileSuccess('Profile updated successfully.')
    }

    setProfileSaving(false)
    router.refresh()
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError('')
    setPwSuccess('')

    if (pwForm.password.length < 8) {
      setPwError('Password must be at least 8 characters.')
      return
    }
    if (pwForm.password !== pwForm.confirm) {
      setPwError('Passwords do not match.')
      return
    }

    setPwSaving(true)
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwForm.password }),
    })
    const data = await res.json()
    setPwSaving(false)

    if (!res.ok) { setPwError(data.error || 'Something went wrong.'); return }
    setPwSuccess('Password updated successfully.')
    setPwForm({ password: '', confirm: '' })
  }

  return (
    <>
      <div className="flex flex-col h-full w-64 bg-gray-900 text-white">
        <div className="flex items-center gap-3 px-6 h-20 border-b border-gray-800">
          <img src="/logo.png" alt="Social CMS logo" className="w-8 h-8 rounded-lg object-cover" />
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
                pathname === href ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
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
          <button
            onClick={openModal}
            className="w-full flex items-center gap-3 px-3 py-2 mb-1 rounded-lg hover:bg-gray-800 transition-colors group text-left"
          >
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-sm font-semibold shrink-0">
              {profile.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{profile.full_name}</p>
              <p className="text-xs text-gray-400 truncate">{profile.email}</p>
            </div>
            <Pencil className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300 shrink-0 transition-colors" />
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
          <button
            onClick={() => setPatchNotesOpen(true)}
            className="w-full text-center text-xs text-gray-600 hover:text-gray-400 transition-colors pt-2"
          >
            v0.1.0
          </button>
        </div>
      </div>

      <PatchNotesModal open={patchNotesOpen} onClose={() => setPatchNotesOpen(false)} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="My Account">
        <div className="space-y-6">

          {/* Profile info */}
          <form onSubmit={saveProfile} className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Profile Information</h3>
            <div>
              <label className={labelCls}>Full Name</label>
              <input
                required
                value={profileForm.full_name}
                onChange={e => setProfileForm(f => ({ ...f, full_name: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Email Address</label>
              <input
                required
                type="email"
                value={profileForm.email}
                onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))}
                className={inputCls}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Changing your email will send a confirmation to the new address.</p>
            </div>
            {profileError && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{profileError}</p>}
            {profileSuccess && (
              <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />{profileSuccess}
              </p>
            )}
            <button
              type="submit"
              disabled={profileSaving}
              className="w-full py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {profileSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </form>

          <div className="border-t border-gray-100 dark:border-gray-800" />

          {/* Change password */}
          <form onSubmit={changePassword} className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Change Password</h3>
            <div>
              <label className={labelCls}>New Password</label>
              <div className="relative">
                <input
                  required
                  type={showPw ? 'text' : 'password'}
                  value={pwForm.password}
                  onChange={e => setPwForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Min. 8 characters"
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className={labelCls}>Confirm New Password</label>
              <input
                required
                type={showPw ? 'text' : 'password'}
                value={pwForm.confirm}
                onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                className={inputCls}
              />
            </div>
            {pwError && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{pwError}</p>}
            {pwSuccess && (
              <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />{pwSuccess}
              </p>
            )}
            <button
              type="submit"
              disabled={pwSaving}
              className="w-full py-2 text-sm font-medium text-white bg-gray-700 hover:bg-gray-600 disabled:bg-gray-500 rounded-lg transition-colors"
            >
              {pwSaving ? 'Updating...' : 'Update Password'}
            </button>
          </form>

        </div>
      </Modal>
    </>
  )
}
