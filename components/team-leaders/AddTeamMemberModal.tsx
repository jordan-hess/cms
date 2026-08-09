'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function AddTeamMemberModal({ open, onClose, onSuccess }: Props) {
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'agent', department: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Failed to create user')
    } else {
      setSuccess(`${form.role === 'admin' ? 'Admin' : 'Agent'} ${form.full_name} created successfully`)
      setForm({ email: '', full_name: '', password: '', role: 'agent', department: '' })
      onSuccess()
    }
    setSaving(false)
  }

  function handleClose() {
    setError('')
    setSuccess('')
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Team Member">
      <form onSubmit={handleInvite} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name *</label>
          <input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
          <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
          <input required type="password" minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            placeholder="Min 8 characters" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="e.g. Sales" />
          </div>
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{success}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={handleClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-medium">
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            {saving ? 'Creating...' : 'Create Account'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
