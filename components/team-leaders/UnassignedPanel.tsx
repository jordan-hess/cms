'use client'

import { Profile } from '@/types'
import PersonCard from './PersonCard'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  people: PersonLite[]
  onEdit: (person: PersonLite) => void
}

export default function UnassignedPanel({ people, onEdit }: Props) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 space-y-2">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Unassigned ({people.length})</p>
      <div className="flex flex-wrap gap-2">
        {people.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3 w-full">No unassigned people</p>
        ) : (
          people.map(p => (
            <div key={p.id} className="w-64">
              <PersonCard person={p} isLeader={false} onEdit={onEdit} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
