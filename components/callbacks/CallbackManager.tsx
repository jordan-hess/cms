'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import { Callback, CallbackStatus } from '@/types'
import { Plus, Phone, Clock, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'

interface Props {
  callbacks: (Callback & { customers: { name: string; phone: string } | null })[]
  customers: { id: string; name: string; phone: string }[]
  userId: string
}

const statusConfig = {
  pending:     { label: 'Pending',     icon: Clock,       color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/30',   badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' },
  completed:   { label: 'Completed',   icon: CheckCircle, color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/30',   badge: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' },
  cancelled:   { label: 'Cancelled',   icon: XCircle,     color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/30',       badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' },
  rescheduled: { label: 'Rescheduled', icon: RefreshCw,   color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/30',     badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' },
}

const empty: { customer_id: string; scheduled_at: string; query_description: string; possible_solution: string; notes: string; status: CallbackStatus } = {
  customer_id: '', scheduled_at: '', query_description: '', possible_solution: '', notes: '', status: 'pending',
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function CallbackManager({ callbacks, customers, userId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [filter, setFilter] = useState<string>('all')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Callback | null>(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filtered = callbacks.filter(c => filter === 'all' || c.status === filter)

  function openAdd() { setEditing(null); setForm(empty); setError(''); setModal(true) }
  function openEdit(cb: Callback) {
    setEditing(cb)
    setForm({
      customer_id: cb.customer_id,
      scheduled_at: cb.scheduled_at.slice(0, 16),
      query_description: cb.query_description,
      possible_solution: cb.possible_solution || '',
      notes: cb.notes || '',
      status: cb.status,
    })
    setError('')
    setModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      ...form,
      scheduled_at: new Date(form.scheduled_at).toISOString(),
      completed_at: form.status === 'completed' ? new Date().toISOString() : null,
    }
    if (editing) {
      const { error } = await supabase.from('callbacks').update(payload).eq('id', editing.id)
      if (error) setError(error.message)
    } else {
      const { error } = await supabase.from('callbacks').insert({ ...payload, agent_id: userId })
      if (error) setError(error.message)
    }
    setSaving(false)
    if (!error) { setModal(false); router.refresh() }
  }

  async function quickStatus(id: string, status: string) {
    await supabase.from('callbacks').update({
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    }).eq('id', id)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
          {['all', 'pending', 'completed', 'cancelled', 'rescheduled'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                filter === s ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >{s}</button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Schedule Callback
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 py-16 text-center">
          <Phone className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No {filter !== 'all' ? filter : ''} callbacks</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800 shadow-sm">
          {filtered.map(cb => {
            const sc = statusConfig[cb.status]
            const Icon = sc.icon
            return (
              <div key={cb.id} className="px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`${sc.bg} rounded-lg p-2 shrink-0`}>
                    <Icon className={`w-4 h-4 ${sc.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{cb.customers?.name || 'Unknown'}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{cb.customers?.phone}</p>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${sc.badge}`}>{sc.label}</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{cb.query_description}</p>
                    {cb.possible_solution && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">Solution: {cb.possible_solution}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2">
                      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <Clock className="w-3 h-3" />
                        {format(new Date(cb.scheduled_at), 'dd MMM yyyy HH:mm')}
                        {' · '}{formatDistanceToNow(new Date(cb.scheduled_at), { addSuffix: true })}
                      </span>
                    </div>
                    {cb.status === 'pending' && (
                      <div className="flex items-center gap-2 mt-2">
                        <button onClick={() => quickStatus(cb.id, 'completed')} className="text-xs text-green-600 dark:text-green-400 hover:text-green-800 font-medium">Mark complete</button>
                        <span className="text-gray-300 dark:text-gray-600">·</span>
                        <button onClick={() => quickStatus(cb.id, 'rescheduled')} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 font-medium">Reschedule</button>
                        <span className="text-gray-300 dark:text-gray-600">·</span>
                        <button onClick={() => openEdit(cb)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium">Edit</button>
                      </div>
                    )}
                    {cb.status !== 'pending' && (
                      <button onClick={() => openEdit(cb)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium mt-2">Edit</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Callback' : 'Schedule Callback'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className={labelCls}>Customer *</label>
            <select required value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className={inputCls}>
              <option value="">Select customer...</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Scheduled Date & Time *</label>
            <input type="datetime-local" required value={form.scheduled_at} onChange={e => setForm({ ...form, scheduled_at: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Query Description *</label>
            <textarea required rows={3} value={form.query_description} onChange={e => setForm({ ...form, query_description: e.target.value })}
              className={`${inputCls} resize-none`} placeholder="Describe the customer's query..." />
          </div>
          <div>
            <label className={labelCls}>Possible Solution</label>
            <textarea rows={2} value={form.possible_solution} onChange={e => setForm({ ...form, possible_solution: e.target.value })}
              className={`${inputCls} resize-none`} placeholder="Proposed resolution..." />
          </div>
          {editing && (
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })} className={inputCls}>
                {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={`${inputCls} resize-none`} />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setModal(false)} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-medium">
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Schedule'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
