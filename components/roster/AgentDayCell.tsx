import { ResolvedDaySlot, TeamColor } from '@/types'
import { statusColorClasses, statusLabels, teamColorClasses } from '@/lib/roster/teamColors'
import { formatShiftTime } from '@/lib/roster/calendarUtils'

interface AgentDayCellProps {
  slot: ResolvedDaySlot
  name: string
  teamColor: TeamColor
  compact?: boolean
  onClick?: () => void
}

export default function AgentDayCell({ slot, name, teamColor, compact = false, onClick }: AgentDayCellProps) {
  const statusClasses = statusColorClasses[slot.effectiveStatus] ?? statusColorClasses.no_rotation
  const teamColors = teamColorClasses[teamColor]
  const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()

  if (compact) {
    return (
      <button
        onClick={onClick}
        title={`${name} — ${statusLabels[slot.effectiveStatus]}`}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs w-full text-left transition-opacity hover:opacity-80 ${statusClasses.bg} ${statusClasses.text}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${teamColors.dot}`} />
        <span className="truncate font-medium">{name.split(' ')[0]}</span>
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full text-left hover:bg-gray-50 transition-colors rounded-lg p-1.5"
    >
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 text-white ${teamColors.bg}`}>
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-900 truncate">{name}</p>
        {slot.shiftTemplate && slot.isWorkDay && (
          <p className="text-xs text-gray-400">
            {formatShiftTime(slot.shiftTemplate.start_time)} – {formatShiftTime(slot.shiftTemplate.end_time)}
          </p>
        )}
      </div>
      <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${statusClasses.bg} ${statusClasses.text}`}>
        {statusLabels[slot.effectiveStatus]}
      </span>
    </button>
  )
}
