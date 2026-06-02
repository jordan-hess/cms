import { Team, TeamMember, ResolvedDaySlot } from '@/types'
import { getMonthGridDays, formatDateKey, isSameMonth, isToday } from '@/lib/roster/calendarUtils'
import { teamColorClasses } from '@/lib/roster/teamColors'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface MonthViewProps {
  year: number
  month: number
  teams: (Team & { team_members: TeamMember[] })[]
  allProfiles: { id: string; full_name: string; is_active: boolean }[]
  slotMap: Map<string, ResolvedDaySlot>
  onCellClick: (profileId: string, date: string) => void
}

export default function MonthView({ year, month, teams, allProfiles, slotMap, onCellClick }: MonthViewProps) {
  const days = getMonthGridDays(year, month)

  const profileTeam = new Map<string, Team>()
  for (const team of teams) {
    for (const member of team.team_members) {
      profileTeam.set(member.profile_id, team)
    }
  }

  const activeProfiles = allProfiles.filter(p => p.is_active)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-800">
        {DAY_LABELS.map(d => (
          <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 divide-x divide-y divide-gray-100 dark:divide-gray-800">
        {days.map((day, idx) => {
          const dateStr = formatDateKey(day)
          const inMonth = isSameMonth(day, year, month)
          const today = isToday(day)

          const teamsOnShift = new Map<string, { team: Team; firstProfileId: string }>()
          for (const p of activeProfiles) {
            const team = profileTeam.get(p.id)
            const slot = slotMap.get(`${p.id}:${dateStr}`)
            if (team && slot && slot.effectiveStatus !== 'no_rotation' && slot.isWorkDay && !teamsOnShift.has(team.id)) {
              teamsOnShift.set(team.id, { team, firstProfileId: p.id })
            }
          }
          const teamChips = [...teamsOnShift.values()]

          return (
            <div
              key={idx}
              className={`min-h-[100px] p-1.5 ${inMonth ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-950'}`}
            >
              <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                today
                  ? 'bg-blue-600 text-white'
                  : inMonth ? 'text-gray-700 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600'
              }`}>
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {teamChips.map(({ team, firstProfileId }) => (
                  <button
                    key={team.id}
                    onClick={() => onCellClick(firstProfileId, dateStr)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs w-full text-left transition-opacity hover:opacity-80 ${teamColorClasses[team.color].lightBg}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${teamColorClasses[team.color].dot}`} />
                    <span className={`truncate font-medium ${teamColorClasses[team.color].text}`}>{team.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
