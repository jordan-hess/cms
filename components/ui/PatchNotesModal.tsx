'use client'

import Modal from './Modal'

interface PatchNote {
  version: string
  date: string
  changes: string[]
}

const PATCH_NOTES: PatchNote[] = [
  {
    version: 'v0.3.0',
    date: '2026-08-09',
    changes: [
      'Management can now create new team member accounts directly from the Team Management page via an "Add Team Member" button, without leaving the board',
      'The Team Management board now shows an "Unassigned" section for people who aren’t on a team yet',
      'Renamed the "Team Leaders Management" page and nav link to "Team Management"',
    ],
  },
  {
    version: 'v0.2.0',
    date: '2026-08-08',
    changes: [
      'Added a Coaching page for management: track monthly 1-on-1 completion between team leaders and their agents, plus management’s own check-ins with each team leader',
      'Added a Team Leaders Management page for management: a drag-and-drop board to move agents between teams, promote someone to team leader by dropping them into a leader slot, and edit or remove people from a team',
      'Management can now create, rename, and delete teams directly from the Team Leaders Management page',
      'The Team Leaders Management board now uses the full page width and scrolls vertically instead of side to side',
    ],
  },
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
