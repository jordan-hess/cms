'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Team, ShiftTemplate, TeamRotation } from '@/types'
import { getISOWeekStart, formatDateKey } from '@/lib/roster/calendarUtils'
import { Plus, Trash2, Loader2 } from 'lucide-react'

const DAY_SHORT: Record<number, string> = { 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thu', 5:'Fri', 6:'Sat', 7:'Sun' }

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
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState('')

  function validateMonday(dateStr: string): boolean {
    const d = new Date(dateStr + 'T00:00:00')
    return d.getDay() === 1
  }

  // Rotations already assigned for the selected team + week
  const currentRotations = teamId && weekStart
    ? existingRotations.filter(r => r.team_id === teamId && r.week_start_date === weekStart)
    : []

  const assignedTemplateIds = new Set(currentRotations.map(r => r.shift_template_id))

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!validateMonday(weekStart)) { setError('Week start must be a Monday.'); return }
    if (!templateId) { setError('Select a shift template.'); return }
    if (assignedTemplateIds.has(templateId)) { setError('That shift is already assigned for this week.'); return }
    setSaving(true); setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('team_rotations')
      .insert({ team_id: teamId, shift_template_id: templateId, week_start_date: weekStart, created_by: currentUserId })

    setSaving(false)
    if (err) { setError(err.message); return }
    setTemplateId('')
    onSuccess()
  }

  async function handleRemove(rotationId: string) {
    setRemoving(rotationId); setError('')
    const supabase = createClient()
    const { error: err } = await supabase.from('team_rotations').delete().eq('id', rotationId)
    setRemoving(null)
    if (err) { setError(err.message); return }
    onSuccess()
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'

  return (
    <Modal open={open} onClose={onClose} title="Assign Rotation">
      <div className="space-y-4">
        {/* Team + week selectors */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Team</label>
          <select required value={teamId} onChange={e => { setTeamId(e.target.value); setTemplateId(''); setError('') }} className={inputCls}>
            <option value="">Select team…</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name} Team</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Week starting (Monday)</label>
          <input
            type="date" required value={weekStart}
            onChange={e => { setWeekStart(e.target.value); setTemplateId(''); setError('') }}
            className={inputCls}
          />
          {weekStart && !validateMonday(weekStart) && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Please select a Monday.</p>
          )}
        </div>

        {/* Current rotations for this team + week */}
        {teamId && weekStart && validateMonday(weekStart) && (
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Assigned shifts this week {currentRotations.length > 0 ? `(${currentRotations.length})` : ''}
            </p>
            {currentRotations.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 px-1">No shifts assigned yet.</p>
            ) : (
              <div className="space-y-1.5">
                {currentRotations.map(r => {
                  const tmpl = shiftTemplates.find(t => t.id === r.shift_template_id)
                  return (
                    <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-200">{tmpl?.name ?? 'Unknown shift'}</p>
                        {tmpl && (
                          <p className="text-xs text-blue-600 dark:text-blue-400">
                            {tmpl.start_time.slice(0, 5)}–{tmpl.end_time.slice(0, 5)}
                            <span className="ml-1.5 text-blue-400 dark:text-blue-500">
                              {tmpl.work_days.map(d => DAY_SHORT[d]).join(', ')}
                            </span>
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemove(r.id)}
                        disabled={removing === r.id}
                        className="p-1.5 text-blue-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors shrink-0"
                        title="Remove rotation"
                      >
                        {removing === r.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Add another shift */}
        <form onSubmit={handleAdd} className="space-y-3 pt-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Add shift template</label>
            <select
              value={templateId}
              onChange={e => { setTemplateId(e.target.value); setError('') }}
              className={inputCls}
              required
            >
              <option value="">Select template…</option>
              {shiftTemplates
                .filter(t => !assignedTemplateIds.has(t.id))
                .map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)} · {t.work_days.map(d => DAY_SHORT[d]).join(', ')})
                  </option>
                ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Close
            </button>
            <button
              type="submit"
              disabled={saving || !teamId || !templateId || !validateMonday(weekStart)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : 'Add shift'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
