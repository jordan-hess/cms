'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { RosterOverride, ShiftTemplate, OverrideType } from '@/types'

const OVERRIDE_TYPES: { value: OverrideType; label: string; description: string }[] = [
  { value: 'off',         label: 'Force Off',    description: 'Agent does not work this day regardless of schedule' },
  { value: 'swap_in',     label: 'Swap In',      description: 'Agent works a different shift on their normally-off day' },
  { value: 'extra_shift', label: 'Extra Shift',  description: 'Agent works an additional shift on top of their schedule' },
]

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  profileId: string
  profileName: string
  date: string
  existing: RosterOverride | null
  shiftTemplates: ShiftTemplate[]
  currentUserId: string
}

export default function RosterOverrideModal({ open, onClose, onSuccess, profileId, profileName, date, existing, shiftTemplates, currentUserId }: Props) {
  const [overrideType, setOverrideType] = useState<OverrideType>(existing?.override_type ?? 'off')
  const [templateId, setTemplateId] = useState(existing?.shift_template_id ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const needsTemplate = overrideType === 'swap_in' || overrideType === 'extra_shift'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (needsTemplate && !templateId) { setError('Please select a shift template for this override type.'); return }
    setSaving(true); setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('roster_overrides')
      .upsert(
        {
          profile_id: profileId,
          date,
          override_type: overrideType,
          shift_template_id: needsTemplate ? templateId : null,
          notes: notes || null,
          created_by: currentUserId,
        },
        { onConflict: 'profile_id,date' }
      )

    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess(); onClose()
  }

  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <Modal open={open} onClose={onClose} title="Override Schedule">
      <div className="mb-4 px-3 py-2 bg-amber-50 rounded-lg border border-amber-100">
        <p className="text-sm font-medium text-gray-900">{profileName}</p>
        <p className="text-xs text-gray-500">{displayDate}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Override type</label>
          <div className="space-y-2">
            {OVERRIDE_TYPES.map(({ value, label, description }) => (
              <label
                key={value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  overrideType === value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio" name="overrideType" value={value}
                  checked={overrideType === value}
                  onChange={() => setOverrideType(value)}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">{label}</p>
                  <p className="text-xs text-gray-500">{description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {needsTemplate && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Shift template to use</label>
            <select
              required={needsTemplate}
              value={templateId} onChange={e => setTemplateId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="">Select template…</option>
              {shiftTemplates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.start_time.slice(0,5)}–{t.end_time.slice(0,5)})</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 rounded-lg transition-colors">
            {saving ? 'Saving…' : 'Apply override'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
