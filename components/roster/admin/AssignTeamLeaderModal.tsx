'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import { Team, TeamLeader } from '@/types'
import { Crown, UserMinus, Loader2 } from 'lucide-react'
import { teamColorClasses } from '@/lib/roster/teamColors'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  agent: { id: string; full_name: string } | null
  teams: Team[]
  teamLeaders: TeamLeader[]
  adminId: string
}

export default function AssignTeamLeaderModal({ open, onClose, onSuccess, agent, teams, teamLeaders, adminId }: Props) {
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setSelectedTeamId('')
    setError('')
  }, [agent, open])

  if (!agent) return null

  // Teams this agent already leads
  const ledTeams = teamLeaders
    .filter(tl => tl.profile_id === agent.id)
    .map(tl => ({ tl, team: teams.find(t => t.id === tl.team_id) }))
    .filter(x => x.team != null) as { tl: TeamLeader; team: Team }[]

  // Teams available to assign (not already led by this agent)
  const availableTeams = teams.filter(t => !ledTeams.some(lt => lt.team.id === t.id))

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedTeamId) return
    setSaving(true)
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('team_leaders')
      .upsert(
        { team_id: selectedTeamId, profile_id: agent!.id, assigned_by: adminId },
        { onConflict: 'team_id' }
      )

    setSaving(false)
    if (err) { setError(err.message); return }
    setSelectedTeamId('')
    onSuccess()
  }

  async function handleRemove(teamId: string) {
    setRemoving(teamId)
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase
      .from('team_leaders')
      .delete()
      .eq('team_id', teamId)
      .eq('profile_id', agent!.id)

    setRemoving(null)
    if (err) { setError(err.message); return }
    onSuccess()
  }

  return (
    <Modal open={open} onClose={onClose} title="Assign Team Leader">
      <div className="space-y-4">
        {/* Agent info */}
        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center text-xs font-semibold text-white shrink-0">
              {agent.full_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{agent.full_name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {ledTeams.length === 0
                  ? 'Not currently assigned as team leader'
                  : `Leading ${ledTeams.length} team${ledTeams.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
        </div>

        {/* Current leadership */}
        {ledTeams.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Currently leading</p>
            {ledTeams.map(({ tl, team }) => {
              const c = teamColorClasses[team.color]
              return (
                <div key={tl.id} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${c.border} ${c.lightBg}`}>
                  <div className="flex items-center gap-2">
                    <Crown className={`w-3.5 h-3.5 ${c.text}`} />
                    <span className={`text-sm font-medium ${c.text}`}>{team.name} Team</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(team.id)}
                    disabled={removing === team.id}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    {removing === team.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserMinus className="w-3 h-3" />}
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Assign to a team */}
        {availableTeams.length > 0 && (
          <form onSubmit={handleAssign} className="space-y-3">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Assign to team</p>
            <select
              required
              value={selectedTeamId}
              onChange={e => setSelectedTeamId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            >
              <option value="">Select team…</option>
              {availableTeams.map(t => {
                const existingLeader = teamLeaders.find(tl => tl.team_id === t.id)
                return (
                  <option key={t.id} value={t.id}>
                    {t.name} Team{existingLeader ? ' (replaces current leader)' : ''}
                  </option>
                )
              })}
            </select>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !selectedTeamId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 rounded-lg transition-colors"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crown className="w-3.5 h-3.5" />}
                {saving ? 'Saving…' : 'Assign as Team Leader'}
              </button>
            </div>
          </form>
        )}

        {availableTeams.length === 0 && ledTeams.length > 0 && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Close
            </button>
          </div>
        )}

        {availableTeams.length === 0 && ledTeams.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">No teams available.</p>
        )}

        {error && availableTeams.length === 0 && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
