'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import { Followup, Priority } from '@/types'
import { Plus, AlertTriangle, Send, Clock } from 'lucide-react'
import { format } from 'date-fns'

interface Props {
  agents: { id: string; full_name: string; email: string }[]
  customers: { id: string; name: string; phone: string }[]
  escalations: (Followup & { customers: any; profiles: any })[]
  adminId: string
}

const empty: { agent_id: string; customer_id: string; query_description: string; possible_solution: string; priority: Priority; due_date: string } = {
  agent_id: '', customer_id: '', query_description: '', possible_solution: '',
  priority: 'high', due_date: '',
}

const priorityBadge: Record<string, string> = {
  low:    'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  normal: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
  high:   'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400',
  urgent: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
}

const statusBadge: Record<string, string> = {
  open:        'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
  in_progress: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
  resolved:    'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
  closed:      'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function EscalationManager({ agents, customers, escalations, adminId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const { data: escalation, error: fuErr } = await supabase.from('followups').insert({
      customer_id: form.customer_id,
      agent_id: form.agent_id,
      created_by: adminId,
      type: 'escalation',
      query_description: form.query_description,
      possible_solution: form.possible_solution || null,
      priority: form.priority,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
      status: 'open',
    }).select().single()

    if (fuErr) { setError(fuErr.message); setSaving(false); return }

    const customer = customers.find(c => c.id === form.customer_id)

    await supabase.from('notifications').insert({
      recipient_id: form.agent_id,
      sender_id: adminId,
      followup_id: escalation.id,
      title: `Escalation: ${customer?.name}`,
      message: form.query_description,
      type: 'escalation',
    })

    setSaving(false)
    setModal(false)
    setForm(empty)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">{escalations.length} total escalations</p>
        <button onClick={() => { setModal(true); setError('') }}
          className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Send className="w-4 h-4" /> Send Escalation
        </button>
      </div>

      {escalations.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 py-16 text-center">
          <AlertTriangle className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No escalations yet</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800 shadow-sm">
          {escalations.map(esc => (
            <div key={esc.id} className="px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-2 shrink-0">
                    <AlertTriangle className="w-4 h-4 text-red-500 dark:text-red-400" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{esc.customers?.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{esc.customers?.phone}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Assigned to: <span className="font-medium">{esc.profiles?.full_name}</span></p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{esc.query_description}</p>
                    {esc.possible_solution && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Solution: {esc.possible_solution}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {esc.due_date && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <Clock className="w-3 h-3" />Due {format(new Date(esc.due_date), 'dd MMM yyyy')}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500">{format(new Date(esc.created_at), 'dd MMM yyyy HH:mm')}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityBadge[esc.priority]}`}>{esc.priority}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[esc.status]}`}>{esc.status.replace('_', ' ')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Send Escalation to Agent">
        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label className={labelCls}>Assign to Agent *</label>
            <select required value={form.agent_id} onChange={e => setForm({ ...form, agent_id: e.target.value })} className={inputCls}>
              <option value="">Select agent...</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.full_name} — {a.email}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Customer *</label>
            <select required value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className={inputCls}>
              <option value="">Select customer...</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Issue Description *</label>
            <textarea required rows={3} value={form.query_description} onChange={e => setForm({ ...form, query_description: e.target.value })}
              className={`${inputCls} resize-none`} placeholder="Describe the escalated issue..." />
          </div>
          <div>
            <label className={labelCls}>Suggested Solution</label>
            <textarea rows={2} value={form.possible_solution} onChange={e => setForm({ ...form, possible_solution: e.target.value })}
              className={`${inputCls} resize-none`} placeholder="Any guidance for the agent..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Priority</label>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as any })} className={inputCls}>
                {['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Due Date</label>
              <input type="datetime-local" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className={inputCls} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setModal(false)} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-lg font-medium">
              <Send className="w-3.5 h-3.5" />
              {saving ? 'Sending...' : 'Send Escalation'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
