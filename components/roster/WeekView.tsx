import { Team, TeamMember, ResolvedDaySlot } from '@/types'
import { getWeekDays, formatDateKey, isToday, formatShiftTime } from '@/lib/roster/calendarUtils'
import { statusColorClasses, statusLabels, teamColorClasses } from '@/lib/roster/teamColors'
import { Edit2 } from 'lucide-react'

interface WeekViewProps {
  currentDate: Date
  teams: (Team & { team_members: TeamMember[] })[]
  allProfiles: { id: string; full_name: string; is_active: boolean }[]
  slotMap: Map<string, ResolvedDaySlot>
  isAdmin: boolean
  onCellClick: (profileId: string, date: string) => void
}

const DAY_SHORT: Record<number, string> = { 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thu', 5:'Fri', 6:'Sat', 0:'Sun' }

export default function WeekView({ currentDate, teams, allProfiles, slotMap, isAdmin, onCellClick }: WeekViewProps) {
  const weekDays = getWeekDays(currentDate)

  const teamGroups: { team: Team; profiles: { id: string; full_name: string }[] }[] = teams.map(team => ({
    team,
    profiles: (team.team_members || [])
      .map(m => allProfiles.find(p => p.id === m.profile_id))
      .filter((p): p is { id: string; full_name: string; is_active: boolean } => !!p && p.is_active),
  })).filter(g => g.profiles.length > 0)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-x-auto">
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-800">
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-44">Agent</th>
            {weekDays.map(day => {
              const today = isToday(day)
              return (
                <th key={formatDateKey(day)} className="text-center px-2 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <div className="flex flex-col items-center gap-0.5">
                    <span>{DAY_SHORT[day.getDay()]}</span>
                    <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${today ? 'bg-blue-600 text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                      {day.getDate()}
                    </span>
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
          {teamGroups.map(({ team, profiles }) => (
            <>
              <tr key={`header-${team.id}`} className="bg-gray-50 dark:bg-gray-800/50">
                <td colSpan={8} className="px-4 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${teamColorClasses[team.color].dot}`} />
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{team.name} Team</span>
                  </div>
                </td>
              </tr>
              {profiles.map(profile => (
                <tr key={profile.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0 ${teamColorClasses[team.color].bg}`}>
                        {team.name.charAt(0)}
                      </div>
                      <span className={`text-xs font-medium truncate ${teamColorClasses[team.color].text}`}>{team.name}</span>
                    </div>
                  </td>
                  {weekDays.map(day => {
                    const dateStr = formatDateKey(day)
                    const slot = slotMap.get(`${profile.id}:${dateStr}`)
                    const sc = slot ? (statusColorClasses[slot.effectiveStatus] ?? statusColorClasses.off) : statusColorClasses.off

                    return (
                      <td key={dateStr} className="px-1 py-1.5 text-center">
                        {slot ? (
                          <button
                            onClick={() => onCellClick(profile.id, dateStr)}
                            className={`w-full rounded px-1 py-1 text-xs font-medium transition-opacity hover:opacity-75 ${sc.bg} ${sc.text}`}
                          >
                            <div>{statusLabels[slot.effectiveStatus]}</div>
                            {slot.shiftTemplate && slot.isWorkDay && (
                              <div className="text-xs opacity-70 mt-0.5">
                                {formatShiftTime(slot.shiftTemplate.start_time)}
                              </div>
                            )}
                            {isAdmin && (
                              <Edit2 className="w-2.5 h-2.5 mx-auto mt-0.5 opacity-50" />
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}
