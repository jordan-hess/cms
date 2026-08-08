'use client'

import { Plus, Crown } from 'lucide-react'
import { TeamBoardColumn, Profile } from '@/types'
import PersonCard from './PersonCard'
import { teamColorClasses } from '@/lib/roster/teamColors'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  column: TeamBoardColumn
  onEdit: (person: PersonLite) => void
  onDeactivate: (personId: string) => void
  onAdd: (teamId: string) => void
}

export default function TeamColumn({ column, onEdit, onDeactivate, onAdd }: Props) {
  const { team, leader, members } = column
  const c = teamColorClasses[team.color]

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col w-72 shrink-0">
      <div className={`px-4 py-3 rounded-t-xl border-b ${c.border} ${c.lightBg}`}>
        <p className={`font-semibold text-sm ${c.text}`}>{team.name}</p>
      </div>

      <div className="p-3 space-y-2">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
          <Crown className="w-3 h-3" /> Leader
        </p>
        <div className="min-h-[52px] rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 p-1">
          {leader ? (
            <PersonCard person={leader} isLeader onEdit={onEdit} onDeactivate={onDeactivate} />
          ) : (
            <p className="text-xs text-gray-400 text-center py-3">No leader assigned</p>
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
        <div className="min-h-[80px] rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 p-1 space-y-1.5">
          {members.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No members</p>
          ) : (
            members.map(m => (
              <PersonCard key={m.id} person={m} isLeader={false} onEdit={onEdit} onDeactivate={onDeactivate} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
