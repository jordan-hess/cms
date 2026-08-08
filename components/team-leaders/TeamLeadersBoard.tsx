'use client'

import { Team, TeamMember, TeamLeader, Profile, TeamBoardColumn } from '@/types'
import TeamColumn from './TeamColumn'

type ProfileLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  teams: Team[]
  teamMembers: TeamMember[]
  teamLeaders: TeamLeader[]
  allProfiles: ProfileLite[]
  currentUserId: string
}

export default function TeamLeadersBoard({ teams, teamMembers, teamLeaders, allProfiles }: Props) {
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

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map(column => (
        <TeamColumn
          key={column.team.id}
          column={column}
          onEdit={() => {}}
          onDeactivate={() => {}}
          onAdd={() => {}}
        />
      ))}
    </div>
  )
}
