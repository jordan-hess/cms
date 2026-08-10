'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Warning, WarningTargetCandidate, WarningType } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  editing: Warning | null
  targetCandidates: WarningTargetCandidate[]
  currentUserId: string
  onSaved: () => void
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function WarningModal({ open, onClose, editing, targetCandidates, currentUserId, onSaved }: Props) {
  const [targetId, setTargetId] = useState(editing?.issued_to ?? '')
  const [type, setType] = useState<WarningType>(editing?.type ?? 'verbal')
  const [reason, setReason] = useState(editing?.reason ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const supabase = createClient()

    if (editing) {
      const { error: err } = await supabase.from('warnings').update({ type, reason }).eq('id', editing.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      if (!targetId) { setError('Please select who this warning is for.'); setSaving(false); return }

      const { data: created, error: err } = await supabase
        .from('warnings')
        .insert({ issued_to: targetId, issued_by: currentUserId, type, reason })
        .select()
        .single()
      if (err) { setError(err.message); setSaving(false); return }

      const targetLabel = targetCandidates.find(c => c.id === targetId)?.full_name ?? ''
      await supabase.from('notifications').insert({
        recipient_id: targetId,
        sender_id: currentUserId,
        title: `You have received a ${type} warning`,
        message: reason,
        type: 'warning',
      })
      void created // insert result unused beyond confirming success; no deep-link needed (see spec)
      void targetLabel
    }

    setSaving(false)
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Warning' : 'New Warning'}>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className={labelCls}>Warning For *</label>
          <select
            required
            disabled={!!editing}
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            className={`${inputCls} disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            <option value="">Select...</option>
            {targetCandidates.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>

        <div>
          <label className={labelCls}>Type *</label>
          <select required value={type} onChange={e => setType(e.target.value as WarningType)} className={inputCls}>
            <option value="verbal">Verbal</option>
            <option value="written">Written</option>
            <option value="final">Final</option>
          </select>
        </div>

        <div>
          <label className={labelCls}>Reason *</label>
          <textarea
            required
            rows={4}
            value={reason}
            onChange={e => setReason(e.target.value)}
            className={`${inputCls} resize-none`}
            placeholder="Describe the reason for this warning..."
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-medium">
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Issue Warning'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
