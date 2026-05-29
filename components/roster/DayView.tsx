import { Team, TeamMember, ResolvedDaySlot } from '@/types'
import { formatDateKey, formatShiftTime } from '@/lib/roster/calendarUtils'
import { statusColorClasses, statusLabels, teamColorClasses } from '@/lib/roster/teamColors'
import { ClipboardEdit, GitPullRequest } from 'lucide-react'

interface DayViewProps {
  currentDate: Date
  teams: (Team & { team_members: TeamMember[] })[]
  allProfiles: { id: string; full_name: string; is_active: boolean }[]
  slotMap: Map<string, ResolvedDaySlot>
  isAdmin: boolean
  onMarkAttendance: (profileId: string, date: string) => void
  onOverride: (profileId: string, date: string) => void
}

export default function DayView({ currentDate, teams, allProfiles, slotMap, isAdmin, onMarkAttendance, onOverride }: DayViewProps) {
  const dateStr = formatDateKey(currentDate)

  const teamGroups = teams.map(team => ({
    team,
    profiles: (team.team_members || [])
      .map(m => allProfiles.find(p => p.id === m.profile_id))
      .filter((p): p is { id: string; full_name: string; is_active: boolean } => !!p && p.is_active),
  })).filter(g => g.profiles.length > 0)

  return (
    <div className="space-y-4">
      {teamGroups.map(({ team, profiles }) => {
        const colors = teamColorClasses[team.color]
        return (
          <div key={team.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className={`px-5 py-3 border-b border-gray-100 flex items-center gap-2 ${colors.lightBg}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
              <h3 className={`text-sm font-semibold ${colors.text}`}>{team.name} Team</h3>
              <span className="text-xs text-gray-400 ml-1">— {profiles.length} member{profiles.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="divide-y divide-gray-50">
              {profiles.map(profile => {
                const slot = slotMap.get(`${profile.id}:${dateStr}`)
                const sc = slot ? (statusColorClasses[slot.effectiveStatus] ?? statusColorClasses.off) : statusColorClasses.off
                const initials = profile.full_name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()

                return (
                  <div key={profile.id} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 ${colors.bg}`}>
                      {initials}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{profile.full_name}</p>
                      {slot?.shiftTemplate && slot.isWorkDay && (
                        <p className="text-xs text-gray-400">
                          {formatShiftTime(slot.shiftTemplate.start_time)} – {formatShiftTime(slot.shiftTemplate.end_time)}
                          {slot.shiftTemplate.name && <span className="ml-1.5 text-gray-300">({slot.shiftTemplate.name})</span>}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {slot && (
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${sc.bg} ${sc.text}`}>
                          {statusLabels[slot.effectiveStatus]}
                        </span>
                      )}
                      {slot?.overrideType && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium">
                          Override
                        </span>
                      )}

                      {isAdmin && (
                        <>
                          <button
                            onClick={() => onMarkAttendance(profile.id, dateStr)}
                            title="Mark attendance"
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <ClipboardEdit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onOverride(profile.id, dateStr)}
                            title="Override schedule"
                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                          >
                            <GitPullRequest className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
