'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Role, Profile } from '@/types'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  person: PersonLite | null
  isCurrentlyLeading: boolean
  onClose: () => void
  onSuccess: () => void
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function EditPersonModal({ person, isCurrentlyLeading, onClose, onSuccess }: Props) {
  // Rendered with a key={person.id} by the caller, so a fresh instance (and
  // fresh initial state below) mounts whenever a different person is edited
  // — no effect needed to "reset" the form on prop change.
  const [form, setForm] = useState(() => ({
    full_name: person?.full_name ?? '',
    department: person?.department ?? '',
    role: (person?.role ?? 'agent') as Role,
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!person) return null
  const currentPerson = person

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (isCurrentlyLeading && form.role !== 'admin') {
      setError('This person currently leads a team — remove them as team leader (drag them out of the leader slot) before changing their role away from admin.')
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: form.full_name, department: form.department || null, role: form.role })
      .eq('id', currentPerson.id)

    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
  }

  return (
    <Modal open={!!person} onClose={onClose} title="Edit Person">
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className={labelCls}>Full Name</label>
          <input required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Department</label>
          <input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Role</label>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))} className={inputCls}>
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
            <option value="management">Management</option>
          </select>
          {isCurrentlyLeading && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Currently leads a team — must stay Admin, or be removed as leader first.</p>
          )}
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors font-medium">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
