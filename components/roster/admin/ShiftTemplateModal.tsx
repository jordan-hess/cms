'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { ShiftTemplate } from '@/types'
import { Plus, Edit2, Trash2, Loader2, ChevronLeft } from 'lucide-react'

const DAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 7 },
]

const DAY_SHORT: Record<number, string> = { 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thu', 5:'Fri', 6:'Sat', 7:'Sun' }

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  shiftTemplates: ShiftTemplate[]
}

type View = 'list' | 'form'

const emptyForm = { name: '', startTime: '08:00', endTime: '16:00', workDays: [1, 2, 3, 4, 5] as number[], description: '' }

export default function ShiftTemplateModal({ open, onClose, onSuccess, shiftTemplates }: Props) {
  const [view, setView] = useState<View>('list')
  const [editing, setEditing] = useState<ShiftTemplate | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) { setView('list'); setEditing(null); setForm(emptyForm); setError(''); setConfirmDelete(null) }
  }, [open])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setView('form')
  }

  function openEdit(t: ShiftTemplate) {
    setEditing(t)
    setForm({
      name: t.name,
      startTime: t.start_time.slice(0, 5),
      endTime: t.end_time.slice(0, 5),
      workDays: t.work_days,
      description: t.description ?? '',
    })
    setError('')
    setView('form')
  }

  function toggleDay(val: number) {
    setForm(prev => ({
      ...prev,
      workDays: prev.workDays.includes(val)
        ? prev.workDays.filter(d => d !== val)
        : [...prev.workDays, val].sort(),
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.workDays.length === 0) { setError('Select at least one work day.'); return }
    setSaving(true); setError('')

    const supabase = createClient()
    const payload = {
      name: form.name,
      start_time: form.startTime,
      end_time: form.endTime,
      work_days: form.workDays,
      description: form.description || null,
    }

    const { error: err } = editing
      ? await supabase.from('shift_templates').update(payload).eq('id', editing.id)
      : await supabase.from('shift_templates').insert(payload)

    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
    setView('list')
    setEditing(null)
  }

  async function handleDelete(id: string) {
    setDeleting(id); setError('')

    const supabase = createClient()
    const { error: err } = await supabase.from('shift_templates').delete().eq('id', id)

    setDeleting(null)
    setConfirmDelete(null)

    if (err) {
      setError(
        err.message.includes('violates foreign key')
          ? 'This shift is assigned to one or more team rotations. Remove those rotations first.'
          : err.message
      )
      return
    }
    onSuccess()
  }

  const title = view === 'list' ? 'Shift Templates' : editing ? 'Edit Shift' : 'New Shift'

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {view === 'list' ? (
        <div className="space-y-3">
          {/* Template list */}
          {shiftTemplates.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">No shift templates yet.</p>
          ) : (
            <div className="space-y-2">
              {shiftTemplates.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{t.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t.start_time.slice(0, 5)} – {t.end_time.slice(0, 5)}
                      <span className="ml-2 text-gray-400 dark:text-gray-500">
                        {t.work_days.map(d => DAY_SHORT[d]).join(', ')}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(t)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {confirmDelete === t.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Sure?</span>
                        <button
                          onClick={() => handleDelete(t.id)}
                          disabled={deleting === t.id}
                          className="text-xs px-2 py-1 text-white bg-red-600 hover:bg-red-700 rounded font-medium disabled:opacity-50"
                        >
                          {deleting === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-xs px-2 py-1 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(t.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Close
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> New shift
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <button
            type="button"
            onClick={() => { setView('list'); setError('') }}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Back to list
          </button>

          <div>
            <label className={labelCls}>Name</label>
            <input
              required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Morning Shift"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start time</label>
              <input type="time" required value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>End time</label>
              <input type="time" required value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Work days</label>
            <div className="flex gap-2 flex-wrap">
              {DAYS.map(({ label, value }) => (
                <button
                  key={value} type="button"
                  onClick={() => toggleDay(value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    form.workDays.includes(value)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Description <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputCls} />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setView('list'); setError('') }} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create shift'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
