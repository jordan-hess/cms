'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Profile, Team, TeamMember, ShiftTemplate, TeamLeader } from '@/types'
import { Plus, Shield, User, Mail, CheckCircle, XCircle, Clock, Users2, Crown } from 'lucide-react'
import AssignShiftModal from '@/components/roster/admin/AssignShiftModal'
import AssignTeamModal from '@/components/roster/admin/AssignTeamModal'
import AssignTeamLeaderModal from '@/components/roster/admin/AssignTeamLeaderModal'
import ManageTeamsModal from '@/components/admin/ManageTeamsModal'
import AddTeamMemberModal from '@/components/team-leaders/AddTeamMemberModal'
import { teamColorClasses } from '@/lib/roster/teamColors'

interface Props {
  agents: Profile[]
  adminId: string
  teams: Team[]
  memberships: TeamMember[]
  shiftTemplates: ShiftTemplate[]
  teamLeaders: TeamLeader[]
}

export default function AgentManager({ agents, adminId, teams, memberships, shiftTemplates, teamLeaders }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [modal, setModal] = useState(false)
  const [assignShiftAgent, setAssignShiftAgent] = useState<{ id: string; full_name: string } | null>(null)
  const [assignTeamAgent, setAssignTeamAgent] = useState<{ id: string; full_name: string } | null>(null)
  const [assignLeaderAgent, setAssignLeaderAgent] = useState<{ id: string; full_name: string } | null>(null)
  const [teamsModal, setTeamsModal] = useState(false)

  function agentTeam(profileId: string) {
    const m = memberships.find(m => m.profile_id === profileId)
    return m ? teams.find(t => t.id === m.team_id) ?? null : null
  }

  function isTeamLeader(profileId: string) {
    return teamLeaders.some(tl => tl.profile_id === profileId)
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
        <p className="text-sm text-gray-500 dark:text-gray-400">{agents.length} team members</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTeamsModal(true)}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2.5 rounded-lg transition-colors"
          >
            <Users2 className="w-4 h-4" /> Manage Teams
          </button>
          <button onClick={() => setModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Add Team Member
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 shadow-sm">
        {agents.map(agent => {
          const leader = isTeamLeader(agent.id)
          return (
            <div key={agent.id} className="px-5 py-4 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                agent.role === 'admin' ? 'bg-purple-500 text-white' : 'bg-blue-500 text-white'
              }`}>
                {agent.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-gray-900 dark:text-white">{agent.full_name}</p>
                  {agent.id === adminId && <span className="text-xs text-gray-400">(you)</span>}
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    agent.role === 'admin' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  }`}>{agent.role}</span>
                  {leader && (
                    <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                      <Crown className="w-3 h-3" />
                      Leader
                    </span>
                  )}
                  {!agent.is_active && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">inactive</span>}
                  {(() => {
                    const team = agentTeam(agent.id)
                    if (!team) return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 font-medium">No team</span>
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
                  <p className="text-xs text-gray-500 dark:text-gray-400">{agent.email}</p>
                  {agent.department && <span className="text-xs text-gray-400">· {agent.department}</span>}
                </div>
              </div>
              {agent.id !== adminId && (
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  <button
                    onClick={() => setAssignTeamAgent({ id: agent.id, full_name: agent.full_name })}
                    className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 border border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500 px-2 py-1 rounded-lg transition-colors"
                    title="Assign team"
                  >
                    <Users2 className="w-3 h-3" /> Assign Team
                  </button>
                  <button
                    onClick={() => setAssignShiftAgent({ id: agent.id, full_name: agent.full_name })}
                    className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 border border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500 px-2 py-1 rounded-lg transition-colors"
                    title="Assign shift"
                  >
                    <Clock className="w-3 h-3" /> Assign Shift
                  </button>
                  {agent.role === 'admin' && (
                    <button
                      onClick={() => setAssignLeaderAgent({ id: agent.id, full_name: agent.full_name })}
                      className={`flex items-center gap-1 text-xs border px-2 py-1 rounded-lg transition-colors ${
                        leader
                          ? 'text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-700 hover:text-red-600 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-500'
                          : 'text-gray-500 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400 border-gray-200 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-500'
                      }`}
                      title={leader ? 'Manage team leadership' : 'Set as team leader'}
                    >
                      <Crown className="w-3 h-3" />
                      {leader ? 'Edit Leader' : 'Set Leader'}
                    </button>
                  )}
                  <button
                    onClick={() => changeRole(agent.id, agent.role === 'admin' ? 'agent' : 'admin')}
                    className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400 border border-gray-200 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-500 px-2 py-1 rounded-lg transition-colors"
                    title={agent.role === 'admin' ? 'Demote to agent' : 'Promote to admin'}
                  >
                    {agent.role === 'admin' ? <User className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                    {agent.role === 'admin' ? 'Make agent' : 'Make admin'}
                  </button>
                  <button
                    onClick={() => toggleActive(agent)}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${
                      agent.is_active
                        ? 'text-gray-500 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 border-gray-200 dark:border-gray-600 hover:border-red-300 dark:hover:border-red-500'
                        : 'text-gray-500 dark:text-gray-300 hover:text-green-600 dark:hover:text-green-400 border-gray-200 dark:border-gray-600 hover:border-green-300 dark:hover:border-green-500'
                    }`}
                  >
                    {agent.is_active ? <XCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                    {agent.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <AssignShiftModal
        open={!!assignShiftAgent}
        onClose={() => setAssignShiftAgent(null)}
        onSuccess={() => { setAssignShiftAgent(null); router.refresh() }}
        profileId={assignShiftAgent?.id ?? ''}
        profileName={assignShiftAgent?.full_name ?? ''}
        shiftTemplates={shiftTemplates}
        currentUserId={adminId}
      />

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

      <AssignTeamLeaderModal
        open={!!assignLeaderAgent}
        onClose={() => setAssignLeaderAgent(null)}
        onSuccess={() => { setAssignLeaderAgent(null); router.refresh() }}
        agent={assignLeaderAgent}
        teams={teams}
        teamLeaders={teamLeaders}
        adminId={adminId}
      />

      <ManageTeamsModal
        open={teamsModal}
        onClose={() => setTeamsModal(false)}
        onSuccess={() => { router.refresh() }}
        teams={teams}
        memberships={memberships}
        teamLeaders={teamLeaders}
        agents={agents}
      />

      <AddTeamMemberModal
        open={modal}
        onClose={() => setModal(false)}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
