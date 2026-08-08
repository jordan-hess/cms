'use client'

import { useDroppable } from '@dnd-kit/core'
import { Plus, Crown, UserPlus, Pencil } from 'lucide-react'
import { TeamBoardColumn, Profile, Team } from '@/types'
import PersonCard from './PersonCard'
import { teamColorClasses } from '@/lib/roster/teamColors'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  column: TeamBoardColumn
  onEdit: (person: PersonLite) => void
  onRemove: (personId: string, teamId: string, isLeader: boolean) => void
  onAdd: (teamId: string) => void
  onAddLeader: (teamId: string) => void
  onRenameTeam: (team: Team) => void
}

export default function TeamColumn({ column, onEdit, onRemove, onAdd, onAddLeader, onRenameTeam }: Props) {
  const { team, leader, members } = column
  const c = teamColorClasses[team.color]

  const { setNodeRef: setLeaderRef, isOver: isLeaderOver } = useDroppable({ id: `leader:${team.id}` })
  const { setNodeRef: setMembersRef, isOver: isMembersOver } = useDroppable({ id: `members:${team.id}` })

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col w-72 shrink-0">
      <div className={`px-4 py-3 rounded-t-xl border-b flex items-center justify-between gap-2 ${c.border} ${c.lightBg}`}>
        <p className={`font-semibold text-sm truncate ${c.text}`}>{team.name}</p>
        <button type="button" onClick={() => onRenameTeam(team)} className={`shrink-0 opacity-60 hover:opacity-100 ${c.text}`} title="Rename team">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
            <Crown className="w-3 h-3" /> Leader
          </p>
          <button type="button" onClick={() => onAddLeader(team.id)} className="text-gray-400 hover:text-purple-600" title="Assign team leader">
            <UserPlus className="w-4 h-4" />
          </button>
        </div>
        <div
          ref={setLeaderRef}
          className={`min-h-13 rounded-lg border-2 border-dashed p-1 transition-colors ${
            isLeaderOver ? 'border-purple-400 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          {leader ? (
            <PersonCard person={leader} isLeader onEdit={onEdit} onRemove={id => onRemove(id, team.id, true)} />
          ) : (
            <p className="text-xs text-gray-400 text-center py-3">Drop someone here to lead this team</p>
          )}
        </div>
      </div>

      <div className="px-3 pb-3 flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Members ({members.length})</p>
          <button type="button" onClick={() => onAdd(team.id)} className="text-gray-400 hover:text-blue-600">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div
          ref={setMembersRef}
          className={`min-h-20 rounded-lg border-2 border-dashed p-1 space-y-1.5 transition-colors ${
            isMembersOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          {members.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No members</p>
          ) : (
            members.map(m => (
              <PersonCard key={m.id} person={m} isLeader={false} onEdit={onEdit} onRemove={id => onRemove(id, team.id, false)} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
