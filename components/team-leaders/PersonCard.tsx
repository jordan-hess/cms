'use client'

import { Pencil, UserX } from 'lucide-react'
import { Profile } from '@/types'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  person: PersonLite
  isLeader: boolean
  onEdit: (person: PersonLite) => void
  onDeactivate: (personId: string) => void
}

export default function PersonCard({ person, isLeader, onEdit, onDeactivate }: Props) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        isLeader
          ? 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20'
          : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900'
      } ${!person.is_active ? 'opacity-50' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{person.full_name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {person.department || person.role}
          {!person.is_active && ' · inactive'}
        </p>
      </div>
      <button type="button" onClick={() => onEdit(person)} className="p-1 text-gray-400 hover:text-blue-600 shrink-0">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={() => onDeactivate(person.id)} className="p-1 text-gray-400 hover:text-red-600 shrink-0">
        <UserX className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
