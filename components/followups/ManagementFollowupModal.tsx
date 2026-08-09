'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Followup, FollowupStatus, FollowupAssignee, FollowupStatusHistory } from '@/types'
import { format } from 'date-fns'
import { insertFollowupHistory } from '@/lib/followups/insertFollowupHistory'
import StatusHistoryTimeline from './StatusHistoryTimeline'

const NEW_CUSTOMER = '__new__'

interface Props {
  open: boolean
  onClose: () => void
  editing: Followup | null
  customers: { id: string; name: string; phone: string }[]
  agentCandidates: FollowupAssignee[]
  teamLeaderCandidates: { profile_id: string; profiles: (FollowupAssignee & { is_active: boolean }) | null }[]
  history: FollowupStatusHistory[]
  userId: string
  onSaved: () => void
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function ManagementFollowupModal({
  open, onClose, editing, customers, agentCandidates, teamLeaderCandidates, history, userId, onSaved,
}: Props) {
  const [agentId, setAgentId] = useState(editing?.agent_id ?? '')
  const [customerId, setCustomerId] = useState(editing?.customer_id ?? '')
  const [queryDescription, setQueryDescription] = useState(editing?.query_description ?? '')
  const [status, setStatus] = useState<FollowupStatus>(editing?.status ?? 'open')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const teamLeaderOptions = useMemo(() => {
    const map = new Map<string, FollowupAssignee>()
    teamLeaderCandidates.forEach(tl => {
      const p = tl.profiles
      if (p && p.is_active && !map.has(p.id)) map.set(p.id, { id: p.id, full_name: p.full_name, email: p.email })
    })
    return Array.from(map.values())
  }, [teamLeaderCandidates])

  if (!open) return null

  const isNewCustomer = customerId === NEW_CUSTOMER

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!agentId) { setError('Please select who to assign this to.'); return }
    if (!customerId) { setError('Please select or create a customer.'); return }
    if (isNewCustomer && (!newCustomerName.trim() || !newCustomerPhone.trim())) {
      setError('Full name and phone are required for a new customer.')
      return
    }

    setSaving(true)
    setError('')
    const supabase = createClient()

    let finalCustomerId = customerId
    if (isNewCustomer) {
      const { data: newCustomer, error: custErr } = await supabase
        .from('customers')
        .insert({ name: newCustomerName.trim(), phone: newCustomerPhone.trim(), created_by: userId })
        .select()
        .single()
      if (custErr) { setError(custErr.message); setSaving(false); return }
      finalCustomerId = newCustomer.id
    }

    const payload = { customer_id: finalCustomerId, agent_id: agentId, query_description: queryDescription }
    const customerLabel = isNewCustomer ? newCustomerName.trim() : customers.find(c => c.id === finalCustomerId)?.name ?? ''

    if (editing) {
      const fromStatus = editing.status
      const { error: err } = await supabase
        .from('followups')
        .update({ ...payload, status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
        .eq('id', editing.id)
      if (err) { setError(err.message); setSaving(false); return }

      if (status !== fromStatus) {
        await insertFollowupHistory(supabase, editing.id, userId, fromStatus, status)
      }
      if (agentId !== editing.agent_id) {
        await supabase.from('notifications').insert({
          recipient_id: agentId,
          sender_id: userId,
          followup_id: editing.id,
          title: `Follow-up reassigned to you: ${customerLabel}`,
          message: queryDescription,
          type: 'followup',
        })
      }
    } else {
      const { data: created, error: err } = await supabase
        .from('followups')
        .insert({ ...payload, created_by: userId, type: 'followup', status: 'open' })
        .select()
        .single()
      if (err) { setError(err.message); setSaving(false); return }

      await supabase.from('notifications').insert({
        recipient_id: agentId,
        sender_id: userId,
        followup_id: created.id,
        title: `New follow-up: ${customerLabel}`,
        message: queryDescription,
        type: 'followup',
      })
    }

    setSaving(false)
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Follow-up' : 'Add Follow-up'}>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className={labelCls}>Assign to *</label>
          <select required value={agentId} onChange={e => setAgentId(e.target.value)} className={inputCls}>
            <option value="">Select agent or team leader...</option>
            <optgroup label="Agents">
              {agentCandidates.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </optgroup>
            <optgroup label="Team Leaders">
              {teamLeaderOptions.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
            </optgroup>
          </select>
        </div>

        <div>
          <label className={labelCls}>Customer *</label>
          <select required value={customerId} onChange={e => setCustomerId(e.target.value)} className={inputCls}>
            <option value="">Select customer...</option>
            <option value={NEW_CUSTOMER}>+ New Customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
          </select>
        </div>

        {isNewCustomer && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Full Name *</label>
              <input required value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone Number *</label>
              <input required value={newCustomerPhone} onChange={e => setNewCustomerPhone(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>Query Description *</label>
          <textarea required rows={3} value={queryDescription} onChange={e => setQueryDescription(e.target.value)}
            className={`${inputCls} resize-none`} placeholder="Describe the customer's issue..." />
        </div>

        {editing ? (
          <div>
            <label className={labelCls}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as FollowupStatus)} className={inputCls}>
              {['open', 'in_progress', 'resolved', 'closed'].map(s => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
            </select>
          </div>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500">Assigned {format(new Date(), 'dd MMM yyyy')}</p>
        )}

        {editing && (
          <div>
            <p className={labelCls}>Status History</p>
            <StatusHistoryTimeline items={history} />
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-medium">
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Follow-up'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
