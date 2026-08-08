'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TeamLeader, TeamMember, Profile, CoachingAgentCheckin, CoachingLeaderCheckin, CoachingLeaderCard } from '@/types'
import LeaderCard from './LeaderCard'
import { Handshake } from 'lucide-react'

type LeaderRow = TeamLeader & { profiles?: Pick<Profile, 'id' | 'full_name' | 'department'> }

interface Props {
  teamLeaders: LeaderRow[]
  teamMembers: TeamMember[]
  agentCheckins: CoachingAgentCheckin[]
  leaderCheckins: CoachingLeaderCheckin[]
  periodMonth: string
  userId: string
}

export default function CoachingManager({ teamLeaders, teamMembers, agentCheckins, leaderCheckins, periodMonth, userId }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [agentDone, setAgentDone] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(agentCheckins.map(c => [c.profile_id, c.done]))
  )
  const [leaderDone, setLeaderDone] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(leaderCheckins.map(c => [c.profile_id, c.done]))
  )
  const [error, setError] = useState('')

  const cards: CoachingLeaderCard[] = (() => {
    const byLeader = new Map<string, { leaderName: string; leaderDepartment: string | null; teamIds: string[] }>()
    for (const tl of teamLeaders) {
      const existing = byLeader.get(tl.profile_id)
      if (existing) {
        existing.teamIds.push(tl.team_id)
      } else {
        byLeader.set(tl.profile_id, {
          leaderName: tl.profiles?.full_name ?? 'Unknown',
          leaderDepartment: tl.profiles?.department ?? null,
          teamIds: [tl.team_id],
        })
      }
    }

    return Array.from(byLeader.entries()).map(([leaderId, info]) => {
      const agents = teamMembers
        .filter(tm => info.teamIds.includes(tm.team_id) && tm.profiles?.is_active !== false)
        .map(tm => ({
          id: tm.profile_id,
          full_name: tm.profiles?.full_name ?? 'Unknown',
          done: agentDone[tm.profile_id] ?? false,
        }))

      return {
        leaderId,
        leaderName: info.leaderName,
        leaderDepartment: info.leaderDepartment,
        teamIds: info.teamIds,
        agents,
        completedCount: agents.filter(a => a.done).length,
        totalCount: agents.length,
        leaderCheckinDone: leaderDone[leaderId] ?? false,
      }
    })
  })()

  async function toggleAgent(agentId: string) {
    const next = !(agentDone[agentId] ?? false)
    setAgentDone(prev => ({ ...prev, [agentId]: next }))
    setError('')

    const { error: err } = await supabase.from('coaching_agent_checkins').upsert(
      {
        profile_id: agentId,
        period_month: periodMonth,
        done: next,
        completed_at: next ? new Date().toISOString() : null,
        marked_by: userId,
      },
      { onConflict: 'profile_id,period_month' }
    )

    if (err) {
      setAgentDone(prev => ({ ...prev, [agentId]: !next }))
      setError('Could not save — please try again.')
      return
    }
    router.refresh()
  }

  async function toggleLeaderCheckin(leaderId: string) {
    const next = !(leaderDone[leaderId] ?? false)
    setLeaderDone(prev => ({ ...prev, [leaderId]: next }))
    setError('')

    const { error: err } = await supabase.from('coaching_leader_checkins').upsert(
      {
        profile_id: leaderId,
        period_month: periodMonth,
        done: next,
        completed_at: next ? new Date().toISOString() : null,
        marked_by: userId,
      },
      { onConflict: 'profile_id,period_month' }
    )

    if (err) {
      setLeaderDone(prev => ({ ...prev, [leaderId]: !next }))
      setError('Could not save — please try again.')
      return
    }
    router.refresh()
  }

  if (cards.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 py-16 text-center">
        <Handshake className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500 dark:text-gray-400 font-medium">No team leaders assigned yet</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Assign team leaders from Manage Agents to start tracking coaching</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(card => (
          <LeaderCard
            key={card.leaderId}
            card={card}
            onToggleAgent={toggleAgent}
            onToggleLeaderCheckin={toggleLeaderCheckin}
          />
        ))}
      </div>
    </div>
  )
}
