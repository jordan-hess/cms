'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { createClient } from '@/lib/supabase/client'
import { Team, TeamMember, TeamLeader, Profile, Role, TeamBoardColumn } from '@/types'
import TeamColumn from './TeamColumn'

type ProfileLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  teams: Team[]
  teamMembers: TeamMember[]
  teamLeaders: TeamLeader[]
  allProfiles: ProfileLite[]
  currentUserId: string
}

export default function TeamLeadersBoard({ teams, teamMembers, teamLeaders, allProfiles, currentUserId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const [error, setError] = useState('')

  function findProfile(id: string) {
    return allProfiles.find(p => p.id === id)
  }

  const columns: TeamBoardColumn[] = teams.map(team => {
    const leaderRow = teamLeaders.find(tl => tl.team_id === team.id)
    const leaderProfile = leaderRow ? findProfile(leaderRow.profile_id) : undefined
    const leader = leaderProfile ? { ...leaderProfile, teamLeaderRowId: leaderRow!.id } : null

    const members = teamMembers
      .filter(tm => tm.team_id === team.id && tm.profile_id !== leader?.id)
      .map(tm => findProfile(tm.profile_id))
      .filter((p): p is ProfileLite => p != null)

    return { team, leader, members }
  })

  async function moveToTeam(personId: string, newTeamId: string) {
    setError('')
    const { error: err } = await supabase.from('team_members')
      .upsert({ profile_id: personId, team_id: newTeamId, joined_at: new Date().toISOString() }, { onConflict: 'profile_id' })
    if (err) { setError('Could not move — please try again.'); return }
    router.refresh()
  }

  async function moveToLeaderSlot(personId: string, newTeamId: string, currentRole: Role) {
    setError('')

    if (currentRole !== 'admin') {
      const { error: promoteErr } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', personId)
      if (promoteErr) { setError('Could not promote to admin — please try again.'); return }
    }

    const oldLed = teamLeaders.find(tl => tl.profile_id === personId)
    if (oldLed && oldLed.team_id !== newTeamId) {
      await supabase.from('team_leaders').delete().eq('team_id', oldLed.team_id).eq('profile_id', personId)
    }

    const { error: leaderErr } = await supabase.from('team_leaders')
      .upsert({ team_id: newTeamId, profile_id: personId, assigned_by: currentUserId }, { onConflict: 'team_id' })
    if (leaderErr) { setError('Could not assign as leader — please try again.'); return }

    const { error: memberErr } = await supabase.from('team_members')
      .upsert({ profile_id: personId, team_id: newTeamId, joined_at: new Date().toISOString() }, { onConflict: 'profile_id' })
    if (memberErr) { setError('Assigned as leader, but could not update team membership — please refresh and check.') }

    router.refresh()
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const data = active.data.current as { personId: string; role: Role } | undefined
    if (!data) return

    const overId = String(over.id)
    if (overId.startsWith('leader:')) {
      void moveToLeaderSlot(data.personId, overId.slice('leader:'.length), data.role)
    } else if (overId.startsWith('members:')) {
      void moveToTeam(data.personId, overId.slice('members:'.length))
    }
  }

  async function handleDeactivate(personId: string) {
    if (!confirm('Deactivate this person? They will no longer be able to log in.')) return
    setError('')
    const { error: err } = await supabase.from('profiles').update({ is_active: false }).eq('id', personId)
    if (err) { setError('Could not deactivate — please try again.'); return }
    router.refresh()
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map(column => (
            <TeamColumn
              key={column.team.id}
              column={column}
              onEdit={() => {}}
              onDeactivate={handleDeactivate}
              onAdd={() => {}}
            />
          ))}
        </div>
      </div>
    </DndContext>
  )
}
