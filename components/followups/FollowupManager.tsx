'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import { Followup, Priority, FollowupStatus, FollowupStatusHistory, FollowupAssignee } from '@/types'
import { Plus, FileText, AlertTriangle, Clock, CheckCircle } from 'lucide-react'
import { format } from 'date-fns'
import { insertFollowupHistory } from '@/lib/followups/insertFollowupHistory'
import StatusHistoryTimeline from './StatusHistoryTimeline'
import ManagementFollowupModal from './ManagementFollowupModal'

interface Props {
  followups: (Followup & { customers: { name: string; phone: string } | null; profiles: { full_name: string } | null; creator: { full_name: string } | null })[]
  customers: { id: string; name: string; phone: string }[]
  userId: string
  isAdmin: boolean
  isManagement?: boolean
  agentCandidates?: FollowupAssignee[]
  teamLeaderCandidates?: { profile_id: string; profiles: (FollowupAssignee & { is_active: boolean }) | null }[]
  statusHistory?: FollowupStatusHistory[]
}

const priorityBadge = {
  low:    'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  normal: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
  high:   'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400',
  urgent: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
}

const statusBadge = {
  open:        'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
  in_progress: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
  resolved:    'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
  closed:      'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
}

const empty: { customer_id: string; query_description: string; possible_solution: string; priority: Priority; due_date: string; notes: string; status: FollowupStatus } = {
  customer_id: '', query_description: '', possible_solution: '', priority: 'normal',
  due_date: '', notes: '', status: 'open',
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function FollowupManager({
  followups, customers, userId, isAdmin,
  isManagement = false, agentCandidates = [], teamLeaderCandidates = [], statusHistory = [],
}: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Followup | null>(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const historyByFollowup = useMemo(() => {
    const map: Record<string, FollowupStatusHistory[]> = {}
    for (const item of statusHistory) {
      if (!map[item.followup_id]) map[item.followup_id] = []
      map[item.followup_id].push(item)
    }
    return map
  }, [statusHistory])

  const filtered = followups.filter(f => {
    const statusMatch = filter === 'all' || f.status === filter
    const typeMatch = typeFilter === 'all' || f.type === typeFilter
    return statusMatch && typeMatch
  })

  function openAdd() { setEditing(null); setForm(empty); setError(''); setModal(true) }
  function openEdit(fu: Followup) {
    setEditing(fu)
    setForm({
      customer_id: fu.customer_id,
      query_description: fu.query_description,
      possible_solution: fu.possible_solution || '',
      priority: fu.priority,
      due_date: fu.due_date ? fu.due_date.slice(0, 16) : '',
      notes: fu.resolution_notes || '',
      status: fu.status,
    })
    setError('')
    setModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      customer_id: form.customer_id,
      query_description: form.query_description,
      possible_solution: form.possible_solution || null,
      priority: form.priority,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
      resolution_notes: form.notes || null,
      status: form.status,
      resolved_at: form.status === 'resolved' ? new Date().toISOString() : null,
    }
    if (editing) {
      const fromStatus = editing.status
      const { error } = await supabase.from('followups').update(payload).eq('id', editing.id)
      if (error) setError(error.message)
      else if (form.status !== fromStatus) {
        await insertFollowupHistory(supabase, editing.id, userId, fromStatus, form.status)
      }
    } else {
      const { error } = await supabase.from('followups').insert({ ...payload, agent_id: userId, created_by: userId, type: 'followup' })
      if (error) setError(error.message)
    }
    setSaving(false)
    if (!error) { setModal(false); router.refresh() }
  }

  async function updateStatus(id: string, status: FollowupStatus) {
    const current = followups.find(f => f.id === id)
    await supabase.from('followups').update({
      status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    }).eq('id', id)
    if (current && current.status !== status) {
      await insertFollowupHistory(supabase, id, userId, current.status, status)
    }
    router.refresh()
  }

  const tabCls = (active: boolean, accent = 'blue') =>
    `px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
      active ? `bg-${accent}-600 text-white` : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
    }`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
          {['all', 'open', 'in_progress', 'resolved', 'closed'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={tabCls(filter === s)}>
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
          {['all', 'followup', 'escalation'].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} className={tabCls(typeFilter === t, 'indigo')}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Add Follow-up
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 py-16 text-center">
          <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No follow-ups found</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800 shadow-sm">
          {filtered.map(fu => (
            <div key={fu.id} className="px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`rounded-lg p-2 shrink-0 ${fu.type === 'escalation' ? 'bg-red-50 dark:bg-red-900/30' : 'bg-blue-50 dark:bg-blue-900/30'}`}>
                    {fu.type === 'escalation'
                      ? <AlertTriangle className="w-4 h-4 text-red-500 dark:text-red-400" />
                      : <FileText className="w-4 h-4 text-blue-500 dark:text-blue-400" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-medium text-gray-900 dark:text-white">{fu.customers?.name || 'Unknown'}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${fu.type === 'escalation' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'}`}>
                        {fu.type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{fu.customers?.phone}</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{fu.query_description}</p>
                    {fu.possible_solution && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Solution: {fu.possible_solution}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      {fu.due_date && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <Clock className="w-3 h-3" />Due {format(new Date(fu.due_date), 'dd MMM yyyy')}
                        </span>
                      )}
                      {(isAdmin || isManagement) && fu.profiles && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">Agent: {(fu.profiles as any).full_name}</span>
                      )}
                      {fu.creator && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">by {(fu.creator as any).full_name}</span>
                      )}
                    </div>
                    {!isManagement && fu.status !== 'resolved' && fu.status !== 'closed' && (
                      <div className="flex items-center gap-2 mt-2">
                        {fu.status === 'open' && (
                          <button onClick={() => updateStatus(fu.id, 'in_progress')} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 font-medium">Start working</button>
                        )}
                        {fu.status === 'in_progress' && (
                          <button onClick={() => updateStatus(fu.id, 'resolved')} className="text-xs text-green-600 dark:text-green-400 hover:text-green-800 font-medium flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Mark resolved
                          </button>
                        )}
                        <span className="text-gray-300 dark:text-gray-600">·</span>
                        <button onClick={() => openEdit(fu)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium">Edit</button>
                      </div>
                    )}
                    {isManagement && (
                      <div className="flex items-center gap-2 mt-2">
                        <button onClick={() => openEdit(fu)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium">Edit</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityBadge[fu.priority]}`}>{fu.priority}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[fu.status]}`}>{fu.status.replace('_', ' ')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isManagement ? (
        <ManagementFollowupModal
          key={editing?.id ?? 'add'}
          open={modal}
          onClose={() => setModal(false)}
          editing={editing}
          customers={customers}
          agentCandidates={agentCandidates}
          teamLeaderCandidates={teamLeaderCandidates}
          history={editing ? historyByFollowup[editing.id] ?? [] : []}
          userId={userId}
          onSaved={() => { setModal(false); router.refresh() }}
        />
      ) : (
        <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Follow-up' : 'Add Follow-up'}>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className={labelCls}>Customer *</label>
              <select required value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className={inputCls}>
                <option value="">Select customer...</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Query Description *</label>
              <textarea required rows={3} value={form.query_description} onChange={e => setForm({ ...form, query_description: e.target.value })}
                className={`${inputCls} resize-none`} placeholder="Describe the customer's issue..." />
            </div>
            <div>
              <label className={labelCls}>Possible Solution</label>
              <textarea rows={2} value={form.possible_solution} onChange={e => setForm({ ...form, possible_solution: e.target.value })}
                className={`${inputCls} resize-none`} placeholder="Proposed resolution..." />
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
            {editing && (
              <div>
                <label className={labelCls}>Status</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })} className={inputCls}>
                  {['open', 'in_progress', 'resolved', 'closed'].map(s => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>Resolution Notes</label>
              <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={`${inputCls} resize-none`} />
            </div>
            {editing && (
              <div>
                <p className={labelCls}>Status History</p>
                <StatusHistoryTimeline items={historyByFollowup[editing.id] ?? []} />
              </div>
            )}
            {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setModal(false)} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-medium">
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Follow-up'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
