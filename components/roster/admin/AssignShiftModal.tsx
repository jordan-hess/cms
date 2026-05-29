'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { ShiftTemplate } from '@/types'
import { getISOWeekStart, formatDateKey } from '@/lib/roster/calendarUtils'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// ISO day-of-week value for each index: 1=Mon … 7=Sun
const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7]

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  profileId: string
  profileName: string
  shiftTemplates: ShiftTemplate[]
  currentUserId: string
}

export default function AssignShiftModal({ open, onClose, onSuccess, profileId, profileName, shiftTemplates, currentUserId }: Props) {
  const todayMonday = formatDateKey(getISOWeekStart(new Date()))

  const [templateId, setTemplateId] = useState('')
  const [weekStart, setWeekStart] = useState(todayMonday)
  const [selectedDays, setSelectedDays] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // When template changes, pre-fill days from its work_days
  useEffect(() => {
    if (!templateId) { setSelectedDays([]); return }
    const tpl = shiftTemplates.find(t => t.id === templateId)
    setSelectedDays(tpl ? [...tpl.work_days] : [])
  }, [templateId, shiftTemplates])

  // Reset on open
  useEffect(() => {
    if (open) { setTemplateId(''); setWeekStart(todayMonday); setSelectedDays([]); setError('') }
  }, [open])

  function toggleDay(iso: number) {
    setSelectedDays(prev => prev.includes(iso) ? prev.filter(d => d !== iso) : [...prev, iso].sort((a, b) => a - b))
  }

  function isValidMonday(dateStr: string): boolean {
    return new Date(dateStr + 'T00:00:00').getDay() === 1
  }

  // Build the actual dates for the selected week's chosen days
  function buildDates(): string[] {
    if (!isValidMonday(weekStart)) return []
    const monday = new Date(weekStart + 'T00:00:00')
    return selectedDays.map(iso => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + (iso - 1)) // iso 1=Mon → offset 0, iso 7=Sun → offset 6
      return formatDateKey(d)
    })
  }

  const selectedTemplate = shiftTemplates.find(t => t.id === templateId)
  const dates = buildDates()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!templateId) { setError('Please select a shift.'); return }
    if (!isValidMonday(weekStart)) { setError('Week start must be a Monday.'); return }
    if (selectedDays.length === 0) { setError('Select at least one day.'); return }

    setSaving(true); setError('')
    const supabase = createClient()

    const records = dates.map(date => ({
      profile_id: profileId,
      date,
      override_type: 'swap_in' as const,
      shift_template_id: templateId,
      notes: null,
      created_by: currentUserId,
    }))

    const { error: err } = await supabase
      .from('roster_overrides')
      .upsert(records, { onConflict: 'profile_id,date' })

    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Assign Shift">
      {/* Agent context */}
      <div className="mb-4 px-3 py-2 bg-gray-50 rounded-lg">
        <p className="text-sm font-medium text-gray-900">{profileName}</p>
        <p className="text-xs text-gray-500">Shift assignment applies as a schedule override</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Shift template */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Shift</label>
          <select
            required
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
          >
            <option value="">Select shift…</option>
            {shiftTemplates.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.start_time.slice(0, 5)} to {t.end_time.slice(0, 5)}
              </option>
            ))}
          </select>
          {selectedTemplate && (
            <p className="text-xs text-gray-400 mt-1">
              Default days: {selectedTemplate.work_days.map(d => DAY_NAMES[d - 1]).join(', ')}
            </p>
          )}
        </div>

        {/* Week picker */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Week starting (Monday)</label>
          <input
            type="date"
            required
            value={weekStart}
            onChange={e => setWeekStart(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          {weekStart && !isValidMonday(weekStart) && (
            <p className="text-xs text-amber-600 mt-1">Please select a Monday.</p>
          )}
        </div>

        {/* Day selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Days to assign</label>
          <div className="flex gap-2 flex-wrap">
            {ISO_DAYS.map((iso, i) => (
              <button
                key={iso}
                type="button"
                onClick={() => toggleDay(iso)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedDays.includes(iso)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {DAY_NAMES[i]}
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        {dates.length > 0 && selectedTemplate && (
          <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 space-y-0.5">
            <p className="font-medium text-blue-700">{dates.length} shift{dates.length !== 1 ? 's' : ''} will be assigned:</p>
            {dates.map(d => (
              <p key={d}>
                {new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}
                {' '}&mdash; {selectedTemplate.start_time.slice(0, 5)}–{selectedTemplate.end_time.slice(0, 5)}
              </p>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
          >
            {saving ? 'Assigning…' : 'Assign shift'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
