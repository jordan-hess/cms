'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Pencil, UserMinus } from 'lucide-react'
import { Profile } from '@/types'

type PersonLite = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>

interface Props {
  person: PersonLite
  isLeader: boolean
  onEdit: (person: PersonLite) => void
  onRemove?: (personId: string) => void
}

export default function PersonCard({ person, isLeader, onEdit, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: person.id,
    data: { personId: person.id, role: person.role },
  })

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        isLeader
          ? 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20'
          : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900'
      } ${isDragging ? 'opacity-40' : ''} ${!person.is_active ? 'opacity-50' : ''}`}
    >
      <div {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{person.full_name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {person.department || person.role}
          {!person.is_active && ' · inactive'}
        </p>
      </div>
      <button type="button" onClick={() => onEdit(person)} className="p-1 text-gray-400 hover:text-blue-600 shrink-0">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      {onRemove && (
        <button type="button" onClick={() => onRemove(person.id)} className="p-1 text-gray-400 hover:text-red-600 shrink-0" title="Remove from team">
          <UserMinus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
