'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import { Profile, Team, TeamMember } from '@/types'
import { Plus, Shield, User, Mail, Loader2, CheckCircle, XCircle, Users2 } from 'lucide-react'
import AssignTeamModal from '@/components/roster/admin/AssignTeamModal'
import { teamColorClasses } from '@/lib/roster/teamColors'

interface Props {
  agents: Profile[]
  adminId: string
  teams: Team[]
  memberships: TeamMember[]
}

export default function AgentManager({ agents, adminId, teams, memberships }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'agent', department: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [assignTeamAgent, setAssignTeamAgent] = useState<{ id: string; full_name: string } | null>(null)

  function agentTeam(profileId: string) {
    const m = memberships.find(m => m.profile_id === profileId)
    return m ? teams.find(t => t.id === m.team_id) ?? null : null
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Failed to create user')
    } else {
      setSuccess(`${form.role === 'admin' ? 'Admin' : 'Agent'} ${form.full_name} created successfully`)
      setForm({ email: '', full_name: '', password: '', role: 'agent', department: '' })
      router.refresh()
    }
    setSaving(false)
  }

  async function toggleActive(agent: Profile) {
    await supabase.from('profiles').update({ is_active: !agent.is_active }).eq('id', agent.id)
    router.refresh()
  }

  async function changeRole(id: string, role: string) {
    await supabase.from('profiles').update({ role }).eq('id', id)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{agents.length} team members</p>
        <button onClick={() => { setModal(true); setError(''); setSuccess('') }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Add Team Member
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 shadow-sm">
        {agents.map(agent => (
          <div key={agent.id} className="px-5 py-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
              agent.role === 'admin' ? 'bg-purple-500 text-white' : 'bg-blue-500 text-white'
            }`}>
              {agent.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-gray-900">{agent.full_name}</p>
                {agent.id === adminId && <span className="text-xs text-gray-400">(you)</span>}
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  agent.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                }`}>{agent.role}</span>
                {!agent.is_active && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">inactive</span>}
                {(() => {
                  const team = agentTeam(agent.id)
                  if (!team) return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 font-medium">No team</span>
                  const c = teamColorClasses[team.color]
                  return (
                    <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${c.lightBg} ${c.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                      {team.name}
                    </span>
                  )
                })()}
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <Mail className="w-3 h-3 text-gray-400" />
                <p className="text-xs text-gray-500">{agent.email}</p>
                {agent.department && <span className="text-xs text-gray-400">· {agent.department}</span>}
              </div>
            </div>
            {agent.id !== adminId && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setAssignTeamAgent({ id: agent.id, full_name: agent.full_name })}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-300 px-2 py-1 rounded-lg transition-colors"
                  title="Assign to team"
                >
                  <Users2 className="w-3 h-3" /> Team
                </button>
                <button
                  onClick={() => changeRole(agent.id, agent.role === 'admin' ? 'agent' : 'admin')}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-purple-600 border border-gray-200 hover:border-purple-300 px-2 py-1 rounded-lg transition-colors"
                  title={agent.role === 'admin' ? 'Demote to agent' : 'Promote to admin'}
                >
                  {agent.role === 'admin' ? <User className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                  {agent.role === 'admin' ? 'Make agent' : 'Make admin'}
                </button>
                <button
                  onClick={() => toggleActive(agent)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${
                    agent.is_active
                      ? 'text-gray-500 hover:text-red-600 border-gray-200 hover:border-red-300'
                      : 'text-gray-500 hover:text-green-600 border-gray-200 hover:border-green-300'
                  }`}
                >
                  {agent.is_active ? <XCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                  {agent.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <AssignTeamModal
        open={!!assignTeamAgent}
        onClose={() => setAssignTeamAgent(null)}
        onSuccess={() => { setAssignTeamAgent(null); router.refresh() }}
        agents={agents}
        teams={teams}
        memberships={memberships}
        preselectedProfileId={assignTeamAgent?.id}
        preselectedName={assignTeamAgent?.full_name}
      />

      <Modal open={modal} onClose={() => setModal(false)} title="Add Team Member">
        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
            <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <input required type="password" minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Min 8 characters" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white">
                <option value="agent">Agent</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g. Sales" />
            </div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {success && <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{success}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setModal(false)} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-medium">
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              {saving ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
