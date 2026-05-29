'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { AttendanceRecord, AttendanceStatus } from '@/types'

const STATUSES: { value: AttendanceStatus; label: string }[] = [
  { value: 'on_shift', label: 'On Shift'  },
  { value: 'late',     label: 'Late'      },
  { value: 'absent',   label: 'Absent'    },
  { value: 'sick',     label: 'Sick'      },
  { value: 'leave',    label: 'Leave'     },
  { value: 'off',      label: 'Off'       },
]

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  profileId: string
  profileName: string
  date: string
  existing: AttendanceRecord | null
  currentUserId: string
}

export default function MarkAttendanceModal({ open, onClose, onSuccess, profileId, profileName, date, existing, currentUserId }: Props) {
  const [status, setStatus] = useState<AttendanceStatus>(existing?.status ?? 'on_shift')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('attendance_records')
      .upsert(
        { profile_id: profileId, date, status, notes: notes || null, marked_by: currentUserId, marked_at: new Date().toISOString() },
        { onConflict: 'profile_id,date' }
      )

    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess(); onClose()
  }

  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <Modal open={open} onClose={onClose} title="Mark Attendance">
      <div className="mb-4 px-3 py-2 bg-gray-50 rounded-lg">
        <p className="text-sm font-medium text-gray-900">{profileName}</p>
        <p className="text-xs text-gray-500">{displayDate}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
          <div className="grid grid-cols-3 gap-2">
            {STATUSES.map(({ value, label }) => (
              <button
                key={value} type="button"
                onClick={() => setStatus(value)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  status === value
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors">
            {saving ? 'Saving…' : 'Save attendance'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
