'use client'

import Modal from './Modal'

interface PatchNote {
  version: string
  date: string
  changes: string[]
}

const PATCH_NOTES: PatchNote[] = [
  {
    version: 'v0.1.0',
    date: '2026-08-07',
    changes: [
      'Added dark mode support across the app, including the login and password-reset screens',
      'Added a role-based console desktop for admin and management users, with draggable, resizable windows for Teamleaders, Agents, and Management',
    ],
  },
]

interface PatchNotesModalProps {
  open: boolean
  onClose: () => void
}

export default function PatchNotesModal({ open, onClose }: PatchNotesModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Patch Notes">
      <div className="space-y-6">
        {PATCH_NOTES.map(note => (
          <div key={note.version}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{note.version}</h3>
              <span className="text-xs text-gray-400 dark:text-gray-500">{note.date}</span>
            </div>
            <ul className="list-disc list-inside space-y-1">
              {note.changes.map((change, i) => (
                <li key={i} className="text-sm text-gray-600 dark:text-gray-400">{change}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  )
}
