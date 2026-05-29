'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { ShiftTemplate } from '@/types'

const DAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 7 },
]

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  editing?: ShiftTemplate | null
}

export default function ShiftTemplateModal({ open, onClose, onSuccess, editing }: Props) {
  const [name, setName] = useState(editing?.name ?? '')
  const [startTime, setStartTime] = useState(editing?.start_time?.slice(0, 5) ?? '08:00')
  const [endTime, setEndTime] = useState(editing?.end_time?.slice(0, 5) ?? '16:00')
  const [workDays, setWorkDays] = useState<number[]>(editing?.work_days ?? [1, 2, 3, 4, 5])
  const [description, setDescription] = useState(editing?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleDay(val: number) {
    setWorkDays(prev => prev.includes(val) ? prev.filter(d => d !== val) : [...prev, val].sort())
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (workDays.length === 0) { setError('Select at least one work day.'); return }
    setSaving(true); setError('')

    const supabase = createClient()
    const payload = { name, start_time: startTime, end_time: endTime, work_days: workDays, description: description || null }

    const { error: err } = editing
      ? await supabase.from('shift_templates').update(payload).eq('id', editing.id)
      : await supabase.from('shift_templates').insert(payload)

    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess(); onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Shift Template' : 'New Shift Template'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            required value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Morning Shift"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start time</label>
            <input
              type="time" required value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End time</label>
            <input
              type="time" required value={endTime} onChange={e => setEndTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Work days</label>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map(({ label, value }) => (
              <button
                key={value} type="button"
                onClick={() => toggleDay(value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  workDays.includes(value)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
          <input
            value={description} onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create template'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
