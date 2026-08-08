'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Profile } from '@/types'

type UnassignedPerson = Pick<Profile, 'id' | 'full_name' | 'email'>

interface Props {
  teamId: string | null
  unassigned: UnassignedPerson[]
  onClose: () => void
  onSuccess: () => void
}

export default function AddToTeamModal({ teamId, unassigned, onClose, onSuccess }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!teamId) return null

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId) return
    setSaving(true)
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('team_members')
      .upsert({ profile_id: selectedId, team_id: teamId, joined_at: new Date().toISOString() }, { onConflict: 'profile_id' })

    setSaving(false)
    if (err) { setError(err.message); return }
    setSelectedId('')
    onSuccess()
  }

  return (
    <Modal open={!!teamId} onClose={onClose} title="Add to Team">
      <form onSubmit={handleAdd} className="space-y-4">
        {unassigned.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No unassigned people available.</p>
        ) : (
          <select
            required
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">Select a person…</option>
            {unassigned.map(p => (
              <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>
            ))}
          </select>
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Cancel</button>
          <button type="submit" disabled={saving || !selectedId} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors font-medium">
            {saving ? 'Adding...' : 'Add to Team'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
