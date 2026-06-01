'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Team, TeamMember, TeamColor } from '@/types'
import { teamColorClasses } from '@/lib/roster/teamColors'
import { Plus, Loader2 } from 'lucide-react'

const COLORS: { value: TeamColor; label: string }[] = [
  { value: 'green',  label: 'Green'  },
  { value: 'blue',   label: 'Blue'   },
  { value: 'red',    label: 'Red'    },
  { value: 'yellow', label: 'Yellow' },
]

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  teams: Team[]
  memberships: TeamMember[]
}

export default function ManageTeamsModal({ open, onClose, onSuccess, teams, memberships }: Props) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<TeamColor>('blue')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function memberCount(teamId: string) {
    return memberships.filter(m => m.team_id === teamId).length
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('teams')
      .insert({ name: name.trim(), color })

    setSaving(false)
    if (err) { setError(err.message); return }
    setName('')
    setColor('blue')
    onSuccess()
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage Teams">
      <div className="space-y-5">
        {/* Team list */}
        <div className="space-y-2">
          {teams.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No teams yet.</p>
          ) : (
            teams.map(team => {
              const c = teamColorClasses[team.color]
              const count = memberCount(team.id)
              return (
                <div key={team.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${c.border} ${c.lightBg}`}>
                  <span className={`w-3 h-3 rounded-full shrink-0 ${c.bg}`} />
                  <span className={`text-sm font-medium flex-1 ${c.text}`}>{team.name}</span>
                  <span className="text-xs text-gray-400">{count} {count === 1 ? 'agent' : 'agents'}</span>
                </div>
              )
            })
          )}
        </div>

        <hr className="border-gray-100 dark:border-gray-800" />

        {/* Create team form */}
        <form onSubmit={handleCreate} className="space-y-4">
          <p className="text-sm font-medium text-gray-700">Create new team</p>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Team name</label>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Alpha"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Color</label>
            <div className="flex gap-2">
              {COLORS.map(c => {
                const cls = teamColorClasses[c.value]
                const selected = color === c.value
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      selected
                        ? `${cls.lightBg} ${cls.text} ${cls.border}`
                        : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${cls.dot}`} />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              Close
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {saving ? 'Creating…' : 'Create team'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
