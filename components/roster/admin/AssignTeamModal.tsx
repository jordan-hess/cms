'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Team, TeamMember } from '@/types'
import { UserMinus } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  agents: { id: string; full_name: string; email: string }[]
  teams: Team[]
  memberships: TeamMember[]
  /** When provided the agent field is locked to this agent */
  preselectedProfileId?: string
  preselectedName?: string
}

export default function AssignTeamModal({ open, onClose, onSuccess, agents, teams, memberships, preselectedProfileId, preselectedName }: Props) {
  const [profileId, setProfileId] = useState(preselectedProfileId ?? '')
  const [teamId, setTeamId] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')

  // Sync when the modal opens for a different agent
  useEffect(() => { setProfileId(preselectedProfileId ?? ''); setTeamId(''); setError('') }, [preselectedProfileId, open])

  const currentMembership = (id: string) => memberships.find(m => m.profile_id === id)
  const currentTeamName = (id: string) => {
    const m = currentMembership(id)
    return m ? teams.find(t => t.id === m.team_id)?.name ?? '—' : 'Unassigned'
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profileId || !teamId) return
    setSaving(true)
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('team_members')
      .upsert({ profile_id: profileId, team_id: teamId, joined_at: new Date().toISOString() }, { onConflict: 'profile_id' })

    setSaving(false)
    if (err) { setError(err.message); return }
    setProfileId(preselectedProfileId ?? ''); setTeamId('')
    onSuccess()
    onClose()
  }

  async function handleRemove() {
    const id = preselectedProfileId ?? profileId
    if (!id || !currentMembership(id)) return
    setRemoving(true)
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('team_members')
      .delete()
      .eq('profile_id', id)

    setRemoving(false)
    if (err) { setError(err.message); return }
    onSuccess()
    onClose()
  }

  const activeProfileId = preselectedProfileId ?? profileId
  const hasTeam = !!currentMembership(activeProfileId)

  return (
    <Modal open={open} onClose={onClose} title="Assign Agent to Team">
      <form onSubmit={handleSubmit} className="space-y-4">
        {preselectedProfileId ? (
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <p className="text-sm font-medium text-gray-900 dark:text-white">{preselectedName}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Currently: {currentTeamName(preselectedProfileId)}</p>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Agent</label>
            <select
              required
              value={profileId}
              onChange={e => setProfileId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="">Select agent…</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.full_name} — currently: {currentTeamName(a.id)}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Team</label>
          <select
            required
            value={teamId}
            onChange={e => setTeamId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">Select team…</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name} Team</option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          {hasTeam && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 rounded-lg transition-colors"
            >
              <UserMinus className="w-3.5 h-3.5" />
              {removing ? 'Removing…' : 'Remove from team'}
            </button>
          )}
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors">
            {saving ? 'Saving…' : 'Assign'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
