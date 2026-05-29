'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Team, ShiftTemplate, TeamRotation } from '@/types'
import { getISOWeekStart, formatDateKey } from '@/lib/roster/calendarUtils'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  teams: Team[]
  shiftTemplates: ShiftTemplate[]
  existingRotations: TeamRotation[]
  currentUserId: string
}

export default function AssignRotationModal({ open, onClose, onSuccess, teams, shiftTemplates, existingRotations, currentUserId }: Props) {
  const todayMonday = formatDateKey(getISOWeekStart(new Date()))
  const [teamId, setTeamId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [weekStart, setWeekStart] = useState(todayMonday)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function validateMonday(dateStr: string): boolean {
    const d = new Date(dateStr + 'T00:00:00')
    return d.getDay() === 1
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validateMonday(weekStart)) { setError('Week start must be a Monday.'); return }
    setSaving(true); setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('team_rotations')
      .upsert(
        { team_id: teamId, shift_template_id: templateId, week_start_date: weekStart, created_by: currentUserId },
        { onConflict: 'team_id,week_start_date' }
      )

    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess(); onClose()
  }

  const existing = teamId && weekStart
    ? existingRotations.find(r => r.team_id === teamId && r.week_start_date === weekStart)
    : null

  return (
    <Modal open={open} onClose={onClose} title="Assign Rotation">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Team</label>
          <select
            required value={teamId} onChange={e => setTeamId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">Select team…</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name} Team</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Week starting (Monday)</label>
          <input
            type="date" required value={weekStart} onChange={e => setWeekStart(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          {weekStart && !validateMonday(weekStart) && (
            <p className="text-xs text-amber-600 mt-1">Please select a Monday.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Shift template</label>
          <select
            required value={templateId} onChange={e => setTemplateId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">Select template…</option>
            {shiftTemplates.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.start_time.slice(0,5)}–{t.end_time.slice(0,5)})</option>
            ))}
          </select>
        </div>

        {existing && (
          <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            This team already has a rotation for that week — saving will replace it.
          </p>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors">
            {saving ? 'Saving…' : 'Assign rotation'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
